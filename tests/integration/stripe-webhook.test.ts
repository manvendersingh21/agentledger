import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  computeStripeWebhookSignature,
  formatStripeSignatureHeader,
  ingestStripeWebhookEvent,
  StripeWebhookVerificationError,
  verifyStripeWebhookSignature,
  type StripeWebhookEvent,
} from "../../lib/payments/webhook.ts";

type Row = { id: string; [column: string]: unknown };

function data<T>(result: { data: T | null; error: { message: string; code?: string } | null }): NonNullable<T> {
  if (result.error) throw new Error(result.error.message);
  if (result.data === null) throw new Error("Expected database response data");
  return result.data as NonNullable<T>;
}

function environment(): { url: string; serviceKey: string } {
  let fallback: Record<string, string> = {};
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    let output: string;
    try {
      output = execFileSync("pnpm", ["exec", "supabase", "status", "-o", "env"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch {
      output = readFileSync("/tmp/agentledger-supabase-b.env", "utf8");
    }
    fallback = Object.fromEntries(
      output.split(/\r?\n/).flatMap((line) => {
        const match = line.match(/^(?:export\s+)?([A-Z0-9_]+)=(?:"([^"]*)"|'([^']*)'|(.*))$/);
        return match ? [[match[1], match[2] ?? match[3] ?? match[4]]] : [];
      }),
    );
  }
  const url = process.env.SUPABASE_URL ?? fallback.SUPABASE_URL ?? fallback.API_URL;
  const serviceKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? fallback.SUPABASE_SERVICE_ROLE_KEY ?? fallback.SERVICE_ROLE_KEY;
  if (!url || !serviceKey) throw new Error("Local Supabase URL and service key are required");
  return { url, serviceKey };
}

const WEBHOOK_SECRET = "whsec_test_agentledger_local";

function paymentIntentEvent(
  id: string,
  type: "payment_intent.succeeded" | "payment_intent.payment_failed",
  piId: string,
  metadata?: Record<string, string>,
): StripeWebhookEvent {
  return {
    id,
    type,
    data: {
      object: {
        id: piId,
        object: "payment_intent",
        status: type === "payment_intent.succeeded" ? "succeeded" : "requires_payment_method",
        ...(metadata ? { metadata } : {}),
      },
    },
  };
}

describe("Stripe webhook (local DB)", () => {
  let service: SupabaseClient;
  let principalId: string;
  let agentId: string;
  let intentId: string;
  let executionId: string;
  const piId = `pi_test_${crypto.randomUUID().replace(/-/g, "")}`;
  const createdUsers: string[] = [];

  beforeAll(async () => {
    const config = environment();
    service = createClient(config.url, config.serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const email = `stripe-wh-${crypto.randomUUID()}@agentledger.dev`;
    const password = `test-${crypto.randomUUID()}`;
    const created = await service.auth.admin.createUser({ email, password, email_confirm: true });
    if (created.error) throw new Error(created.error.message);
    principalId = created.data.user.id;
    createdUsers.push(principalId);

    const setup = await service.rpc("ensure_principal_setup", {
      p_principal_id: principalId,
      p_display_name: "Stripe webhook test",
    });
    if (setup.error || typeof setup.data !== "string") throw new Error("ensure_principal_setup failed");
    agentId = setup.data;

    const delegation = data<Row>(
      await service.from("delegations").select("id").eq("principal_id", principalId).returns<Row[]>().single(),
    );

    const intent = data<Row>(
      await service
        .from("action_intents")
        .insert({
          principal_id: principalId,
          agent_id: agentId,
          delegation_id: delegation.id,
          status: "executing",
          payload: { product_id: "20000000-0000-4000-8000-000000000001" },
          amount_cents: 1500,
          currency: "usd",
          merchant_slug: "acme-api",
          product_id: "20000000-0000-4000-8000-000000000001",
          recurring: false,
          idempotency_key: crypto.randomUUID(),
        })
        .select("id")
        .returns<Row[]>()
        .single(),
    );
    intentId = intent.id as string;

    const execution = data<Row>(
      await service
        .from("executions")
        .insert({
          intent_id: intentId,
          principal_id: principalId,
          idempotency_key: crypto.randomUUID(),
          status: "pending",
          provider: "stripe",
          provider_operation_id: piId,
        })
        .select("id")
        .returns<Row[]>()
        .single(),
    );
    executionId = execution.id as string;
  });

  afterAll(async () => {
    for (const id of createdUsers) {
      await service.auth.admin.deleteUser(id);
    }
  });

  it("accepts a valid signature", async () => {
    const event = paymentIntentEvent(`evt_${crypto.randomUUID()}`, "payment_intent.succeeded", piId);
    const payload = JSON.stringify(event);
    const timestamp = Math.floor(Date.now() / 1000);
    const sig = await computeStripeWebhookSignature(payload, WEBHOOK_SECRET, timestamp);
    await expect(
      verifyStripeWebhookSignature({
        payload,
        signatureHeader: formatStripeSignatureHeader(timestamp, sig),
        secret: WEBHOOK_SECRET,
      }),
    ).resolves.toBeUndefined();
  });

  it("rejects a tampered payload", async () => {
    const event = paymentIntentEvent(`evt_${crypto.randomUUID()}`, "payment_intent.succeeded", piId);
    const payload = JSON.stringify(event);
    const timestamp = Math.floor(Date.now() / 1000);
    const sig = await computeStripeWebhookSignature(payload, WEBHOOK_SECRET, timestamp);
    await expect(
      verifyStripeWebhookSignature({
        payload: payload.replace("succeeded", "failed"),
        signatureHeader: formatStripeSignatureHeader(timestamp, sig),
        secret: WEBHOOK_SECRET,
      }),
    ).rejects.toMatchObject({ code: "SIGNATURE_MISMATCH" });
  });

  it("rejects an expired timestamp", async () => {
    const event = paymentIntentEvent(`evt_${crypto.randomUUID()}`, "payment_intent.succeeded", piId);
    const payload = JSON.stringify(event);
    const timestamp = Math.floor(Date.now() / 1000) - 400;
    const sig = await computeStripeWebhookSignature(payload, WEBHOOK_SECRET, timestamp);
    await expect(
      verifyStripeWebhookSignature({
        payload,
        signatureHeader: formatStripeSignatureHeader(timestamp, sig),
        secret: WEBHOOK_SECRET,
        nowSeconds: Math.floor(Date.now() / 1000),
      }),
    ).rejects.toBeInstanceOf(StripeWebhookVerificationError);
  });

  it("reconciles payment_intent.succeeded and replays the same event id as a no-op", async () => {
    const eventId = `evt_${crypto.randomUUID()}`;
    const event = paymentIntentEvent(eventId, "payment_intent.succeeded", piId);

    const first = await ingestStripeWebhookEvent(service, event);
    expect(first).toEqual({ outcome: "recorded", reconciled: true });

    const stripeRow = data<Row[]>(
      await service.from("stripe_events").select("id, type").eq("id", eventId).returns<Row[]>(),
    );
    expect(stripeRow).toHaveLength(1);

    const audits = data<Row[]>(
      await service
        .from("audit_events")
        .select("event_type, event_data")
        .eq("intent_id", intentId)
        .eq("event_type", "PAYMENT_SUCCEEDED")
        .returns<Row[]>(),
    );
    const webhookAudits = audits.filter((row) => (row.event_data as { source?: string }).source === "stripe_webhook");
    expect(webhookAudits).toHaveLength(1);
    expect((webhookAudits[0].event_data as { payment_intent_id: string }).payment_intent_id).toBe(piId);
    expect((webhookAudits[0].event_data as { matched_by: string }).matched_by).toBe("provider_operation_id");

    const execution = data<Row>(
      await service.from("executions").select("status").eq("id", executionId).returns<Row[]>().single(),
    );
    expect(execution.status).toBe("pending");

    const second = await ingestStripeWebhookEvent(service, event);
    expect(second).toEqual({ outcome: "duplicate" });

    const auditsAfter = data<Row[]>(
      await service
        .from("audit_events")
        .select("id")
        .eq("intent_id", intentId)
        .eq("event_type", "PAYMENT_SUCCEEDED")
        .contains("event_data", { source: "stripe_webhook", payment_intent_id: piId })
        .returns<Row[]>(),
    );
    expect(auditsAfter).toHaveLength(1);
  });

  it("reconciles when provider_operation_id is not set yet but PaymentIntent metadata matches the execution", async () => {
    const racePiId = `pi_test_${crypto.randomUUID().replace(/-/g, "")}`;
    const delegation = data<Row>(
      await service.from("delegations").select("id").eq("principal_id", principalId).returns<Row[]>().single(),
    );

    const raceIntent = data<Row>(
      await service
        .from("action_intents")
        .insert({
          principal_id: principalId,
          agent_id: agentId,
          delegation_id: delegation.id,
          status: "executing",
          payload: { product_id: "20000000-0000-4000-8000-000000000001" },
          amount_cents: 1500,
          currency: "usd",
          merchant_slug: "acme-api",
          product_id: "20000000-0000-4000-8000-000000000001",
          recurring: false,
          idempotency_key: crypto.randomUUID(),
        })
        .select("id")
        .returns<Row[]>()
        .single(),
    );
    const raceIntentId = raceIntent.id as string;

    const raceExecution = data<Row>(
      await service
        .from("executions")
        .insert({
          intent_id: raceIntentId,
          principal_id: principalId,
          idempotency_key: crypto.randomUUID(),
          status: "pending",
          provider: "stripe",
          provider_operation_id: null,
        })
        .select("id")
        .returns<Row[]>()
        .single(),
    );
    const raceExecutionId = raceExecution.id as string;

    const eventId = `evt_${crypto.randomUUID()}`;
    const event = paymentIntentEvent(eventId, "payment_intent.succeeded", racePiId, {
      agentledger_intent_id: raceIntentId,
      agentledger_execution_id: raceExecutionId,
      principal_id: principalId,
      agent_id: agentId,
    });

    const result = await ingestStripeWebhookEvent(service, event);
    expect(result).toEqual({ outcome: "recorded", reconciled: true });

    const linked = data<Row>(
      await service
        .from("executions")
        .select("provider_operation_id, status")
        .eq("id", raceExecutionId)
        .returns<Row[]>()
        .single(),
    );
    expect(linked.provider_operation_id).toBe(racePiId);
    expect(linked.status).toBe("pending");

    const audits = data<Row[]>(
      await service
        .from("audit_events")
        .select("event_data")
        .eq("intent_id", raceIntentId)
        .eq("event_type", "PAYMENT_SUCCEEDED")
        .contains("event_data", { source: "stripe_webhook", payment_intent_id: racePiId })
        .returns<Row[]>(),
    );
    expect(audits).toHaveLength(1);
    expect((audits[0].event_data as { matched_by: string }).matched_by).toBe("agentledger_execution_id");
  });
});

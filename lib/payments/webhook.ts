// Stripe webhook verification + payment reconciliation (runtime-agnostic: Node + Deno).
import type { SupabaseClient } from "@supabase/supabase-js";
import { appendAuditEvent } from "../domain/audit.ts";

const DEFAULT_TOLERANCE_SECONDS = 300;

export interface StripeWebhookEvent {
  id: string;
  type: string;
  data: { object: Record<string, unknown> };
}

export class StripeWebhookVerificationError extends Error {
  readonly code: "MISSING_HEADER" | "INVALID_HEADER" | "TIMESTAMP_EXPIRED" | "SIGNATURE_MISMATCH";

  constructor(code: StripeWebhookVerificationError["code"], message: string) {
    super(message);
    this.code = code;
  }
}

function bytesToHex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Constant-time comparison for equal-length hex strings. */
export function constantTimeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return bytesToHex(sig);
}

export function parseStripeSignatureHeader(header: string): { timestamp: number; signatures: string[] } {
  const parts = header.split(",");
  let timestamp: number | null = null;
  const signatures: string[] = [];
  for (const part of parts) {
    const [key, value] = part.split("=", 2);
    if (!key || !value) continue;
    if (key === "t") timestamp = Number.parseInt(value, 10);
    if (key === "v1") signatures.push(value);
  }
  if (timestamp === null || !Number.isFinite(timestamp) || signatures.length === 0) {
    throw new StripeWebhookVerificationError("INVALID_HEADER", "Malformed Stripe-Signature header");
  }
  return { timestamp, signatures };
}

export async function computeStripeWebhookSignature(
  payload: string,
  secret: string,
  timestamp: number,
): Promise<string> {
  return hmacSha256Hex(secret, `${timestamp}.${payload}`);
}

export function formatStripeSignatureHeader(timestamp: number, signatureHex: string): string {
  return `t=${timestamp},v1=${signatureHex}`;
}

export async function verifyStripeWebhookSignature(input: {
  payload: string;
  signatureHeader: string | null;
  secret: string;
  toleranceSeconds?: number;
  nowSeconds?: number;
}): Promise<void> {
  if (!input.signatureHeader?.trim()) {
    throw new StripeWebhookVerificationError("MISSING_HEADER", "Missing Stripe-Signature header");
  }
  const { timestamp, signatures } = parseStripeSignatureHeader(input.signatureHeader);
  const tolerance = input.toleranceSeconds ?? DEFAULT_TOLERANCE_SECONDS;
  const now = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (Math.abs(now - timestamp) > tolerance) {
    throw new StripeWebhookVerificationError("TIMESTAMP_EXPIRED", "Stripe webhook timestamp outside tolerance");
  }
  const expected = await computeStripeWebhookSignature(input.payload, input.secret, timestamp);
  const matched = signatures.some((sig) => constantTimeEqualHex(sig, expected));
  if (!matched) {
    throw new StripeWebhookVerificationError("SIGNATURE_MISMATCH", "Stripe webhook signature mismatch");
  }
}

export function paymentIntentIdFromEvent(event: StripeWebhookEvent): string | null {
  const obj = event.data.object;
  const id = obj.id;
  if (event.type.startsWith("payment_intent.") && typeof id === "string" && id.startsWith("pi_")) return id;
  return null;
}

function paymentIntentMetadataFromEvent(event: StripeWebhookEvent): Record<string, string> {
  const raw = event.data.object.metadata;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === "string") out[key] = value;
  }
  return out;
}

type MatchedExecution = {
  id: string;
  intent_id: string;
  principal_id: string;
  provider_operation_id: string | null;
};

async function findExecutionForPaymentIntent(
  db: SupabaseClient,
  paymentIntentId: string,
  metadata: Record<string, string>,
): Promise<{ execution: MatchedExecution; matchedBy: "agentledger_execution_id" | "provider_operation_id" } | null> {
  const executionIdFromMeta = metadata.agentledger_execution_id;
  if (executionIdFromMeta) {
    const { data, error } = await db
      .from("executions")
      .select("id, intent_id, principal_id, provider_operation_id")
      .eq("id", executionIdFromMeta)
      .maybeSingle();
    if (error) throw new Error(`execution lookup by metadata failed: ${error.message}`);
    if (data) {
      return {
        execution: data as MatchedExecution,
        matchedBy: "agentledger_execution_id",
      };
    }
  }

  const { data, error } = await db
    .from("executions")
    .select("id, intent_id, principal_id, provider_operation_id")
    .eq("provider_operation_id", paymentIntentId)
    .maybeSingle();
  if (error) throw new Error(`execution lookup by provider_operation_id failed: ${error.message}`);
  if (!data) return null;
  return {
    execution: data as MatchedExecution,
    matchedBy: "provider_operation_id",
  };
}

async function webhookReconciliationExists(
  db: SupabaseClient,
  intentId: string,
  paymentIntentId: string,
): Promise<boolean> {
  const { data, error } = await db
    .from("audit_events")
    .select("id")
    .eq("intent_id", intentId)
    .in("event_type", ["PAYMENT_SUCCEEDED", "PAYMENT_FAILED"])
    .contains("event_data", { source: "stripe_webhook", payment_intent_id: paymentIntentId })
    .limit(1);
  if (error) throw new Error(`webhook reconciliation lookup failed: ${error.message}`);
  return (data?.length ?? 0) > 0;
}

export type StripeWebhookIngestResult =
  | { outcome: "duplicate" }
  | { outcome: "recorded"; reconciled: boolean };

/**
 * Idempotently records the Stripe event, then reconciles payment_intent.* events against executions.
 */
export async function ingestStripeWebhookEvent(
  db: SupabaseClient,
  event: StripeWebhookEvent,
): Promise<StripeWebhookIngestResult> {
  const paymentIntentId = paymentIntentIdFromEvent(event);
  const { error: insertError } = await db.from("stripe_events").insert({
    id: event.id,
    type: event.type,
    payment_intent_id: paymentIntentId,
    payload: event,
  });
  if (insertError) {
    if (insertError.code === "23505") return { outcome: "duplicate" };
    throw new Error(`stripe_events insert failed: ${insertError.message}`);
  }

  if (event.type !== "payment_intent.succeeded" && event.type !== "payment_intent.payment_failed") {
    return { outcome: "recorded", reconciled: false };
  }
  if (!paymentIntentId) return { outcome: "recorded", reconciled: false };

  const metadata = paymentIntentMetadataFromEvent(event);
  const match = await findExecutionForPaymentIntent(db, paymentIntentId, metadata);
  if (!match) return { outcome: "recorded", reconciled: false };

  const { execution, matchedBy } = match;
  const intentId = execution.intent_id;
  const principalId = execution.principal_id;

  if (execution.provider_operation_id === null) {
    const { error: linkError } = await db
      .from("executions")
      .update({ provider_operation_id: paymentIntentId })
      .eq("id", execution.id)
      .is("provider_operation_id", null);
    if (linkError) throw new Error(`execution provider_operation_id update failed: ${linkError.message}`);
  }

  if (await webhookReconciliationExists(db, intentId, paymentIntentId)) {
    return { outcome: "recorded", reconciled: false };
  }

  const { data: intent, error: intentError } = await db
    .from("action_intents")
    .select("id, agent_id")
    .eq("id", intentId)
    .maybeSingle();
  if (intentError) throw new Error(`intent lookup failed: ${intentError.message}`);
  if (!intent) return { outcome: "recorded", reconciled: false };

  const agentId = metadata.agent_id ?? (intent.agent_id as string);
  const succeeded = event.type === "payment_intent.succeeded";

  await appendAuditEvent(db, {
    principalId,
    agentId,
    intentId,
    eventType: succeeded ? "PAYMENT_SUCCEEDED" : "PAYMENT_FAILED",
    eventData: {
      source: "stripe_webhook",
      stripe_event_id: event.id,
      payment_intent_id: paymentIntentId,
      matched_by: matchedBy,
      execution_id: execution.id,
      webhook_type: event.type,
    },
  });

  return { outcome: "recorded", reconciled: true };
}

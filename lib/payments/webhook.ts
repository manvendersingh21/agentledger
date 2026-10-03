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

  const { data: execution, error: execError } = await db
    .from("executions")
    .select("id, intent_id, principal_id, status")
    .eq("provider_operation_id", paymentIntentId)
    .maybeSingle();
  if (execError) throw new Error(`execution lookup failed: ${execError.message}`);
  if (!execution) return { outcome: "recorded", reconciled: false };

  const intentId = execution.intent_id as string;
  const principalId = execution.principal_id as string;

  if (await webhookReconciliationExists(db, intentId, paymentIntentId)) {
    return { outcome: "recorded", reconciled: false };
  }

  const { data: intent, error: intentError } = await db
    .from("action_intents")
    .select("id, agent_id, status")
    .eq("id", intentId)
    .maybeSingle();
  if (intentError) throw new Error(`intent lookup failed: ${intentError.message}`);
  if (!intent) return { outcome: "recorded", reconciled: false };

  const intentStatus = intent.status as string;
  const agentId = intent.agent_id as string;

  if (event.type === "payment_intent.payment_failed" && intentStatus === "executed") {
    return { outcome: "recorded", reconciled: false };
  }

  const succeeded = event.type === "payment_intent.succeeded";
  const executionStatus = execution.status as string;

  if (executionStatus === "pending") {
    const { error: updateExecError } = await db
      .from("executions")
      .update({
        status: succeeded ? "succeeded" : "failed",
        completed_at: new Date().toISOString(),
        ...(succeeded ? {} : { error: { source: "stripe_webhook", stripe_event_id: event.id } }),
      })
      .eq("id", execution.id)
      .eq("status", "pending");
    if (updateExecError) throw new Error(`execution update failed: ${updateExecError.message}`);
  }

  if (succeeded && intentStatus === "executing") {
    const { error: intentUpdateError } = await db
      .from("action_intents")
      .update({ status: "executed" })
      .eq("id", intentId)
      .eq("status", "executing");
    if (intentUpdateError) throw new Error(`intent update failed: ${intentUpdateError.message}`);
  }
  if (!succeeded && intentStatus === "executing") {
    const { error: intentUpdateError } = await db
      .from("action_intents")
      .update({ status: "failed" })
      .eq("id", intentId)
      .eq("status", "executing");
    if (intentUpdateError) throw new Error(`intent update failed: ${intentUpdateError.message}`);
  }

  await appendAuditEvent(db, {
    principalId,
    agentId,
    intentId,
    eventType: succeeded ? "PAYMENT_SUCCEEDED" : "PAYMENT_FAILED",
    eventData: {
      source: "stripe_webhook",
      stripe_event_id: event.id,
      payment_intent_id: paymentIntentId,
      execution_id: execution.id,
      webhook_type: event.type,
    },
  });

  return { outcome: "recorded", reconciled: true };
}

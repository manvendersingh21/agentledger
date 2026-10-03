// Stripe webhook (Supabase Edge Function). Shares verification + reconciliation with Next.js.
import { createClient } from "@supabase/supabase-js";
import {
  ingestStripeWebhookEvent,
  StripeWebhookVerificationError,
  verifyStripeWebhookSignature,
  type StripeWebhookEvent,
} from "../../../lib/payments/webhook.ts";

function serviceRoleKey(): string {
  return (
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ??
    Deno.env.get("SUPABASE_SECRET_KEY") ??
    Deno.env.get("SB_SECRET_KEY") ??
    ""
  );
}

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return json(405, { error: "METHOD_NOT_ALLOWED" });
  }

  const secret = Deno.env.get("STRIPE_WEBHOOK_SECRET");
  if (!secret) {
    return json(503, { error: "SERVICE_UNAVAILABLE", message: "Stripe webhook is not configured." });
  }

  const payload = await req.text();
  const signatureHeader = req.headers.get("stripe-signature");

  try {
    await verifyStripeWebhookSignature({ payload, signatureHeader, secret });
  } catch (error) {
    if (error instanceof StripeWebhookVerificationError) {
      return json(400, { error: error.code, message: error.message });
    }
    throw error;
  }

  let event: StripeWebhookEvent;
  try {
    event = JSON.parse(payload) as StripeWebhookEvent;
  } catch {
    return json(400, { error: "INVALID_PAYLOAD", message: "Webhook body must be JSON." });
  }
  if (!event?.id || !event?.type || !event?.data?.object) {
    return json(400, { error: "INVALID_PAYLOAD", message: "Malformed Stripe event." });
  }

  const url = Deno.env.get("SUPABASE_URL");
  const key = serviceRoleKey();
  if (!url || !key) {
    return json(500, { error: "server misconfigured" });
  }
  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

  const result = await ingestStripeWebhookEvent(db, event);
  return json(200, { received: true, duplicate: result.outcome === "duplicate" });
});

import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  ingestStripeWebhookEvent,
  StripeWebhookVerificationError,
  verifyStripeWebhookSignature,
  type StripeWebhookEvent,
} from "@/lib/payments/webhook";

export async function POST(request: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "SERVICE_UNAVAILABLE", message: "Stripe webhook is not configured." }, { status: 503 });
  }

  const payload = await request.text();
  const signatureHeader = request.headers.get("stripe-signature");

  try {
    await verifyStripeWebhookSignature({ payload, signatureHeader, secret });
  } catch (error) {
    if (error instanceof StripeWebhookVerificationError) {
      return NextResponse.json({ error: error.code, message: error.message }, { status: 400 });
    }
    throw error;
  }

  let event: StripeWebhookEvent;
  try {
    event = JSON.parse(payload) as StripeWebhookEvent;
  } catch {
    return NextResponse.json({ error: "INVALID_PAYLOAD", message: "Webhook body must be JSON." }, { status: 400 });
  }
  if (!event?.id || !event?.type || !event?.data?.object) {
    return NextResponse.json({ error: "INVALID_PAYLOAD", message: "Malformed Stripe event." }, { status: 400 });
  }

  const db = createAdminClient();
  const result = await ingestStripeWebhookEvent(db, event);
  return NextResponse.json({ received: true, duplicate: result.outcome === "duplicate" });
}

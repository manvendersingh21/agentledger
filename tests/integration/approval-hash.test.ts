// Hash-bound approvals: tampering intent terms after approval must block execution.
import { execSync } from "node:child_process";
import { beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { ensurePrincipalSetup, proposePurchase, resolveApproval, type DomainContext } from "@/lib/domain/pipeline";
import { loadAuditEvents } from "@/lib/domain/audit";
import type { PaymentProvider, PaymentRequest, PaymentResult } from "@/lib/payments/provider";

function localEnv(): { url: string; serviceKey: string } {
  if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return { url: process.env.SUPABASE_URL, serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY };
  }
  const out = execSync("pnpm exec supabase status -o env", { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  const get = (k: string) => out.match(new RegExp(`^${k}="?([^"\\n]+)"?`, "m"))?.[1] ?? "";
  return { url: get("API_URL"), serviceKey: get("SERVICE_ROLE_KEY") };
}

class CountingProvider implements PaymentProvider {
  readonly name = "demo" as const;
  readonly label = "Counting test provider";
  calls: PaymentRequest[] = [];
  async executePurchase(request: PaymentRequest): Promise<PaymentResult> {
    this.calls.push(request);
    return {
      ok: true,
      provider: "demo",
      providerReference: `test_pi_${request.idempotencyKey.slice(-12)}`,
      status: "succeeded",
      livemode: false,
      raw: { amount: request.amountCents },
    };
  }
}

let db: SupabaseClient;
let acmeProductId: string;

beforeAll(async () => {
  const env = localEnv();
  db = createClient(env.url, env.serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await db
    .from("products")
    .select("id, merchants!inner(slug)")
    .eq("merchants.slug", "acme-api")
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!data?.id) throw new Error("acme-api product not found");
  acmeProductId = data.id as string;
});

describe("approval intent hash (integration)", () => {
  it("denies execution with APPROVAL_HASH_MISMATCH when intent amount is tampered after approval request", async () => {
    const email = `hash-${crypto.randomUUID().slice(0, 8)}@test.agentledger.dev`;
    const { data: userData, error: userError } = await db.auth.admin.createUser({
      email,
      password: "test-password-123",
      email_confirm: true,
    });
    if (userError || !userData.user) throw userError ?? new Error("no user");
    const agentId = await ensurePrincipalSetup(db, userData.user.id, "hash-test");
    const ctx: DomainContext & { payments: CountingProvider } = {
      db,
      principalId: userData.user.id,
      agentId,
      payments: new CountingProvider(),
      channel: "test",
    };

    const proposed = await proposePurchase(ctx, { product_id: acmeProductId, reason: "needs approval" });
    expect(proposed.status).toBe("awaiting_approval");
    if (proposed.status !== "awaiting_approval") return;

    const { data: approval } = await db
      .from("approvals")
      .select("intent_hash")
      .eq("id", proposed.approval_id)
      .single();
    expect(approval?.intent_hash).toBeTruthy();

    const tamperedAmount = proposed.authoritative.amount_cents + 500;
    const { error: tamperError } = await db
      .from("action_intents")
      .update({ amount_cents: tamperedAmount })
      .eq("id", proposed.intent_id);
    expect(tamperError).toBeNull();

    const resolved = await resolveApproval(ctx, proposed.approval_id, "approved", "looks good");
    expect(resolved.resolved).toBe(true);
    expect(resolved.execution?.status).toBe("denied");
    if (resolved.execution?.status === "denied") {
      expect(resolved.execution.violations).toContain("APPROVAL_HASH_MISMATCH");
    }
    expect(ctx.payments.calls).toHaveLength(0);

    const { data: intent } = await db.from("action_intents").select("status").eq("id", proposed.intent_id).single();
    expect(intent?.status).toBe("denied");

    const events = await loadAuditEvents(db, ctx.principalId, { intentId: proposed.intent_id });
    expect(events.map((e) => e.eventType)).toContain("APPROVAL_HASH_MISMATCH");
  });
});

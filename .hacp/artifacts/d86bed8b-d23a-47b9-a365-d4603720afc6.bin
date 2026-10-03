// End-to-end pipeline tests against the local Supabase stack (run `pnpm db:reset` first).
import { execSync } from "node:child_process";
import { beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  ensurePrincipalSetup,
  executeAction,
  NotAuthorizedError,
  proposePurchase,
  resolveApproval,
  searchProducts,
  type DomainContext,
} from "@/lib/domain/pipeline";
import { loadAuditEvents, verifyPrincipalChain } from "@/lib/domain/audit";
import { verifyAuditChain } from "@/lib/crypto/audit-chain";
import type { PaymentProvider, PaymentRequest, PaymentResult } from "@/lib/payments/provider";

function localEnv(): { url: string; serviceKey: string } {
  if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return { url: process.env.SUPABASE_URL, serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY };
  }
  const out = execSync("pnpm exec supabase status -o env", { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  const get = (k: string) => out.match(new RegExp(`^${k}="?([^"\\n]+)"?`, "m"))?.[1] ?? "";
  return { url: get("API_URL"), serviceKey: get("SERVICE_ROLE_KEY") };
}

/** Counts real provider invocations so we can prove "at most one charge". */
class CountingProvider implements PaymentProvider {
  readonly name = "demo" as const;
  readonly label = "Counting test provider";
  calls: PaymentRequest[] = [];
  async executePurchase(request: PaymentRequest): Promise<PaymentResult> {
    this.calls.push(request);
    await new Promise((r) => setTimeout(r, 50)); // widen the race window
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
const products: Record<string, string> = {};

async function makeUser(label: string): Promise<DomainContext & { payments: CountingProvider }> {
  const email = `${label}-${crypto.randomUUID().slice(0, 8)}@test.agentledger.dev`;
  const { data, error } = await db.auth.admin.createUser({ email, password: "test-password-123", email_confirm: true });
  if (error || !data.user) throw error ?? new Error("no user");
  const agentId = await ensurePrincipalSetup(db, data.user.id, label);
  return { db, principalId: data.user.id, agentId, payments: new CountingProvider(), channel: "test" };
}

beforeAll(async () => {
  const env = localEnv();
  db = createClient(env.url, env.serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await db.from("products").select("id, merchants!inner(slug)");
  if (error) throw error;
  for (const row of data as unknown as { id: string; merchants: { slug: string } }[]) products[row.merchants.slug] = row.id;
  for (const slug of ["acme-api", "vectorbase", "devhost", "cheapcompute", "evil-cloud"]) {
    expect(products[slug], `seed product for ${slug}`).toBeTruthy();
  }
});

describe("AgentLedger pipeline (real Postgres)", () => {
  it("denies the prompt-injected $500 recurring Evil Cloud purchase with all three violations", async () => {
    const ctx = await makeUser("injection");
    const result = await proposePurchase(ctx, { product_id: products["evil-cloud"] });
    expect(result.status).toBe("denied");
    if (result.status !== "denied") return;
    expect(result.violations).toEqual(
      expect.arrayContaining(["TRANSACTION_LIMIT_EXCEEDED", "RECURRING_NOT_ALLOWED", "MERCHANT_NOT_ALLOWED"]),
    );
    expect(result.authoritative.amount_cents).toBe(50000);
    expect(ctx.payments.calls).toHaveLength(0);
    const { data: intent } = await db.from("action_intents").select("status").eq("id", result.intent_id).single();
    expect(intent?.status).toBe("denied");
  });

  it("denies a subscription and an unauthorized merchant", async () => {
    const ctx = await makeUser("subs");
    const sub = await proposePurchase(ctx, { product_id: products["devhost"] });
    expect(sub.status).toBe("denied");
    if (sub.status === "denied") expect(sub.violations).toContain("RECURRING_NOT_ALLOWED");
    const merchant = await proposePurchase(ctx, { product_id: products["cheapcompute"] });
    expect(merchant.status).toBe("denied");
    if (merchant.status === "denied") expect(merchant.violations).toContain("MERCHANT_NOT_ALLOWED");
  });

  it("ignores agent-claimed price/recurring/merchant (parameter tampering)", async () => {
    const ctx = await makeUser("tamper");
    const result = await proposePurchase(ctx, {
      product_id: products["evil-cloud"],
      claimed_amount_cents: 500,
      claimed_recurring: false,
      claimed_merchant: "acme-api",
    });
    expect(result.status).toBe("denied");
    if (result.status !== "denied") return;
    expect(result.authoritative).toMatchObject({ amount_cents: 50000, recurring: true, merchant: "evil-cloud" });
    const events = await loadAuditEvents(db, ctx.principalId, { intentId: result.intent_id });
    expect(events.map((e) => e.eventType)).toContain("PARAMETER_TAMPERING_DETECTED");
  });

  it("requires approval for $15, blocks other users from approving, executes once, and blocks replays", async () => {
    const alice = await makeUser("alice");
    const mallory = await makeUser("mallory");

    const proposed = await proposePurchase(alice, { product_id: products["acme-api"], reason: "cheapest >=100k" });
    expect(proposed.status).toBe("awaiting_approval");
    if (proposed.status !== "awaiting_approval") return;

    // Executing before approval is not possible.
    const early = await executeAction(alice, proposed.intent_id);
    expect(early.status).toBe("not_executable");

    // Another authenticated principal cannot approve Alice's action.
    await expect(resolveApproval(mallory, proposed.approval_id, "approved")).rejects.toBeInstanceOf(NotAuthorizedError);

    const approved = await resolveApproval(alice, proposed.approval_id, "approved");
    expect(approved.resolved).toBe(true);
    expect(approved.execution?.status).toBe("executed");
    expect(alice.payments.calls).toHaveLength(1);

    // Approval is single-use.
    const again = await resolveApproval(alice, proposed.approval_id, "approved");
    expect(again.resolved).toBe(false);

    // Concurrent + sequential retries never charge again.
    const retries = await Promise.all(Array.from({ length: 5 }, () => executeAction(alice, proposed.intent_id)));
    for (const r of retries) expect(r.status).toBe("duplicate");
    expect(alice.payments.calls).toHaveLength(1);
    const { count } = await db.from("executions").select("id", { count: "exact", head: true }).eq("intent_id", proposed.intent_id);
    expect(count).toBe(1);
    const { count: receipts } = await db.from("receipts").select("id", { count: "exact", head: true }).eq("intent_id", proposed.intent_id);
    expect(receipts).toBe(1);

    const events = await loadAuditEvents(db, alice.principalId, { intentId: proposed.intent_id });
    expect(events.map((e) => e.eventType)).toEqual(
      expect.arrayContaining(["HUMAN_APPROVAL_REQUESTED", "HUMAN_APPROVED", "PAYMENT_SUCCEEDED", "RECEIPT_CREATED", "DUPLICATE_EXECUTION_BLOCKED"]),
    );
  });

  it("returns the original intent when a proposal is replayed with the same idempotency key", async () => {
    const ctx = await makeUser("replay");
    const key = `replay-${crypto.randomUUID()}`;
    const first = await proposePurchase(ctx, { product_id: products["acme-api"], idempotency_key: key });
    const second = await proposePurchase(ctx, { product_id: products["acme-api"], idempotency_key: key });
    expect(first.status).toBe("awaiting_approval");
    expect(second.status).toBe("replay");
    if (first.status === "awaiting_approval" && second.status === "replay") expect(second.intent_id).toBe(first.intent_id);
  });

  it("enforces the daily limit cumulatively", async () => {
    const ctx = await makeUser("daily");
    const statuses: string[] = [];
    for (let i = 0; i < 4; i++) {
      const r = await proposePurchase(ctx, { product_id: products["acme-api"] });
      statuses.push(r.status);
      if (r.status === "awaiting_approval") await resolveApproval(ctx, r.approval_id, "approved");
    }
    // 3 x $15 = $45 committed; the 4th would make $60 > $50.
    expect(statuses.slice(0, 3)).toEqual(["awaiting_approval", "awaiting_approval", "awaiting_approval"]);
    expect(statuses[3]).toBe("denied");
  });

  it("produces a verifiable audit chain that fails verification when tampered", async () => {
    const ctx = await makeUser("audit");
    await searchProducts(ctx, "API plan");
    await proposePurchase(ctx, { product_id: products["evil-cloud"] });
    const verification = await verifyPrincipalChain(db, ctx.principalId);
    expect(verification.valid).toBe(true);
    expect(verification.verifiedCount).toBeGreaterThanOrEqual(5);

    const events = await loadAuditEvents(db, ctx.principalId);
    const tampered = events.map((e) => ({ ...e }));
    tampered[1] = { ...tampered[1], eventData: { ...(tampered[1].eventData as object), amount_cents: 500 } };
    expect((await verifyAuditChain(tampered)).valid).toBe(false);

    // The database itself refuses to rewrite history.
    const { error } = await db.from("audit_events").update({ event_type: "FORGED" }).eq("id", events[0].id);
    expect(error).not.toBeNull();
  });
});

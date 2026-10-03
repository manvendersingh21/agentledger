import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  ensurePrincipalSetup,
  type DomainContext,
} from "@/lib/domain/pipeline";
import type { PaymentProvider, PaymentRequest, PaymentResult } from "@/lib/payments/provider";
import {
  pickProductForRestock,
  runRestock,
  simulateBusyNight,
  reconcileAutopilotReceipts,
  type InventoryItemRow,
} from "@/lib/domain/inventory";
import { contentHash, type AssessListingInput } from "@/lib/risk/jev";

function localEnv(): { url: string; serviceKey: string } {
  if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return { url: process.env.SUPABASE_URL, serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY };
  }
  let output: string;
  try {
    output = execFileSync("pnpm", ["exec", "supabase", "status", "-o", "env"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch {
    output = readFileSync("/tmp/agentledger-supabase-b.env", "utf8");
  }
  const get = (k: string) => output.match(new RegExp(`^${k}="?([^"\\n]+)"?`, "m"))?.[1] ?? "";
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

/** Trusted "Frying Oil 35lb" from seed-catalog.sql — the product the autopilot picks for the oil item. */
const OIL_PRODUCT_ID = "20000000-0000-4000-8000-000000000301";

interface RiskSeedProductRow {
  id: string;
  name: string;
  description: string;
  metadata: Record<string, unknown>;
  price_cents: number;
  currency: string;
  recurring: boolean;
  merchants: {
    name: string;
    domain: string | null;
    trust_score: number | string | null;
    trust_score_source: string | null;
    verified: boolean | null;
  };
}

/**
 * Tests have no JEV_API_KEY, and "Jev unavailable ⇒ require human approval" is intentional fail-closed
 * behavior (tests/policy/guardrails.test.ts). To exercise the autopilot auto-buy path we provide clean
 * risk signals through the real cache (risk_assessments keyed by product_id + content_hash), exactly as
 * a prior live assessment would have.
 */
async function seedCleanRiskSignals(principalId: string, productId: string): Promise<void> {
  const { data, error } = await db
    .from("products")
    .select(
      "id, name, description, metadata, price_cents, currency, recurring, merchants!inner(name, domain, trust_score, trust_score_source, verified)",
    )
    .eq("id", productId)
    .single();
  if (error || !data) throw error ?? new Error("risk seed product missing");
  const product = data as unknown as RiskSeedProductRow;
  const rpm = product.metadata?.requests_per_month;
  // Mirror resolveMerchantTrust: fixture merchants keep their labelled score, so the hash matches runtime.
  const trustSource = product.merchants.trust_score_source;
  const input: AssessListingInput = {
    productName: product.name,
    merchantName: product.merchants.name,
    merchantDomain: product.merchants.domain ?? null,
    description: product.description,
    metadata: product.metadata,
    priceCents: product.price_cents,
    currency: product.currency,
    recurring: product.recurring,
    requestsPerMonth: typeof rpm === "number" ? rpm : null,
    merchantTrustScore:
      product.merchants.trust_score === null || product.merchants.trust_score === undefined
        ? null
        : Number(product.merchants.trust_score),
    merchantTrustSource: trustSource === "scamadvisor" || trustSource === "fixture" ? trustSource : "unavailable",
    merchantVerified: product.merchants.verified === true,
  };
  const { error: insertError } = await db.from("risk_assessments").insert({
    principal_id: principalId,
    product_id: productId,
    provider: "jev",
    model: "jev-fixture",
    prompt_injection: 0.01,
    crypto_exfiltration: 0.01,
    price_anomaly: 0.02,
    content_hash: await contentHash(input),
    raw: { fixture: "inventory integration test — clean signals", merchant_risk: 0.01 },
  });
  if (insertError) throw new Error(insertError.message);
}

async function restaurantCtx(label: string): Promise<DomainContext & { payments: CountingProvider }> {
  const email = `${label}-${crypto.randomUUID().slice(0, 8)}@test.agentledger.dev`;
  const { data, error } = await db.auth.admin.createUser({ email, password: "test-password-123", email_confirm: true });
  if (error || !data.user) throw error ?? new Error("no user");
  const agentId = await ensurePrincipalSetup(db, data.user.id, label);

  const { data: merchants } = await db.from("merchants").select("slug").eq("trusted", true);
  const restaura = (merchants ?? []).find((m) => (m as { slug: string }).slug === "restaura-supply");
  const allowed = restaura ? ["restaura-supply"] : ((merchants ?? []) as { slug: string }[]).map((m) => m.slug);

  await db
    .from("delegations")
    .update({
      max_amount_cents: 12000,
      daily_limit_cents: 60000,
      approval_threshold_cents: 7500,
      allowed_merchants: allowed,
      allowed_categories: ["restaurant_food", "restaurant_supplies"],
      blocked_categories: ["crypto", "gift_card", "wire_transfer"],
      scenario: "restaurant",
      min_trust_score: 95,
    })
    .eq("principal_id", data.user.id)
    .eq("agent_id", agentId);

  await seedCleanRiskSignals(data.user.id, OIL_PRODUCT_ID);

  return { db, principalId: data.user.id, agentId, payments: new CountingProvider(), channel: "test" };
}

async function oilItem(ctx: DomainContext): Promise<InventoryItemRow> {
  const { data, error } = await ctx.db
    .from("inventory_items")
    .select("*")
    .eq("principal_id", ctx.principalId)
    .ilike("name", "%frying%")
    .maybeSingle();
  if (error || !data) throw error ?? new Error("frying oil inventory row missing");
  return data as InventoryItemRow;
}

beforeAll(async () => {
  const env = localEnv();
  db = createClient(env.url, env.serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { count, error } = await db.from("products").select("id", { count: "exact", head: true }).eq("category", "restaurant_food");
  if (error) throw error;
  if ((count ?? 0) < 1) {
    throw new Error("Restaurant catalog missing — run pnpm db:reset to apply seed-catalog.sql");
  }
});

describe("restaurant inventory autopilot", () => {
  it("skips cheaper untrusted oil and auto-buys trusted supplier when stock is low", async () => {
    const ctx = await restaurantCtx("inv-oil");
    const item = await oilItem(ctx);
    await ctx.db.from("inventory_items").update({ on_hand: 10 }).eq("id", item.id);

    const pick = await pickProductForRestock(ctx.db, item, ["restaura-supply"]);
    expect(pick).not.toBeNull();
    expect(pick?.product.merchants.slug).toBe("restaura-supply");
    expect(pick?.skippedCheaperUntrusted?.merchant_name).toMatch(/bargain/i);

    const { results } = await runRestock({ ...ctx, channel: "autopilot" });
    const oilLine = results.find((r) => r.item_name.toLowerCase().includes("frying"));
    expect(oilLine?.outcome).toBe("auto_bought");
    expect(oilLine?.message).toMatch(/skipped cheaper untrusted/i);
    expect(ctx.payments.calls.length).toBeGreaterThanOrEqual(1);

    const after = await oilItem(ctx);
    expect(Number(after.on_hand)).toBeGreaterThan(10);
  });

  it("simulate busy night drops stock deterministically with fixed seed", async () => {
    // Two fresh principals start from identical seed inventory; the same seed must
    // produce identical per-item results, and each run must decrement stock.
    const ctxA = await restaurantCtx("inv-sim-a");
    const ctxB = await restaurantCtx("inv-sim-b");

    const before = await ctxA.db.from("inventory_items").select("on_hand").eq("principal_id", ctxA.principalId);
    const afterA = await simulateBusyNight(ctxA, 42);
    const afterB = await simulateBusyNight(ctxB, 42);

    const sumBefore = ((before.data ?? []) as { on_hand: number }[]).reduce((s, r) => s + Number(r.on_hand), 0);
    const sumAfterA = afterA.reduce((s, r) => s + Number(r.on_hand), 0);

    expect(sumAfterA).toBeLessThan(sumBefore);
    expect(afterA.map((r) => [r.name, Number(r.on_hand)])).toEqual(afterB.map((r) => [r.name, Number(r.on_hand)]));
  });

  it("reconcile applies inventory when an executed intent was not marked applied", async () => {
    const ctx = await restaurantCtx("inv-reconcile");
    const item = await oilItem(ctx);
    await ctx.db.from("inventory_items").update({ on_hand: 5 }).eq("id", item.id);

    const { results } = await runRestock({ ...ctx, channel: "autopilot" });
    const line = results.find((r) => r.inventory_item_id === item.id);
    expect(line?.intent_id).toBeTruthy();

    await ctx.db
      .from("inventory_items")
      .update({ on_hand: 5 })
      .eq("id", item.id);
    await ctx.db
      .from("action_intents")
      .update({
        payload: {
          channel: "autopilot",
          inventory_restock: true,
          inventory_item_id: item.id,
          inventory_unit_add: 35,
          quantity: 1,
        },
      })
      .eq("id", line!.intent_id!);

    const { reconciled } = await reconcileAutopilotReceipts(ctx);
    expect(reconciled).toContain(line!.intent_id);
    const after = await oilItem(ctx);
    expect(Number(after.on_hand)).toBe(40);
  });
});

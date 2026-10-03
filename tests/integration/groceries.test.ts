import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { checkout, planBasket } from "@/lib/domain/groceries";
import { ensurePrincipalSetup, type DomainContext } from "@/lib/domain/pipeline";
import type { PaymentProvider, PaymentRequest, PaymentResult } from "@/lib/payments/provider";
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
  const get = (key: string) => output.match(new RegExp(`^${key}="?([^"\\n]+)"?`, "m"))?.[1] ?? "";
  return { url: get("API_URL"), serviceKey: get("SERVICE_ROLE_KEY") };
}

class GroceryPaymentProvider implements PaymentProvider {
  readonly name = "demo" as const;
  readonly label = "Grocery integration provider";
  calls: PaymentRequest[] = [];

  async executePurchase(request: PaymentRequest): Promise<PaymentResult> {
    this.calls.push(request);
    return {
      ok: true,
      provider: "demo",
      providerReference: `grocery_pi_${request.idempotencyKey.slice(-10)}`,
      status: "succeeded",
      livemode: false,
      raw: { amount: request.amountCents },
    };
  }
}

interface RiskProductRow {
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

const MILK_PRODUCT_ID = "20000000-0000-4000-8000-000000000501";
const COFFEE_PRODUCT_ID = "20000000-0000-4000-8000-000000000515";

let db: SupabaseClient;

async function seedCleanRisk(principalId: string, productId: string): Promise<void> {
  const { data, error } = await db
    .from("products")
    .select(
      "id, name, description, metadata, price_cents, currency, recurring, merchants!inner(name, domain, trust_score, trust_score_source, verified)",
    )
    .eq("id", productId)
    .single();
  if (error || !data) throw error ?? new Error("grocery risk product missing");
  const product = data as unknown as RiskProductRow;
  // Mirror resolveMerchantTrust: fixture merchants keep their labelled score, so the hash matches runtime.
  const trustSource = product.merchants.trust_score_source;
  const input: AssessListingInput = {
    productName: product.name,
    merchantName: product.merchants.name,
    merchantDomain: product.merchants.domain,
    description: product.description,
    metadata: product.metadata,
    priceCents: product.price_cents,
    currency: product.currency,
    recurring: product.recurring,
    requestsPerMonth: null,
    merchantTrustScore:
      product.merchants.trust_score === null || product.merchants.trust_score === undefined
        ? null
        : Number(product.merchants.trust_score),
    merchantTrustSource: trustSource === "scamadvisor" || trustSource === "fixture" ? trustSource : "unavailable",
    merchantVerified: product.merchants.verified === true,
  };
  const { error: riskError } = await db.from("risk_assessments").insert({
    principal_id: principalId,
    product_id: productId,
    provider: "jev",
    model: "jev-fixture",
    prompt_injection: 0.01,
    crypto_exfiltration: 0.01,
    price_anomaly: 0.01,
    content_hash: await contentHash(input),
    raw: { fixture: "groceries integration test", merchant_risk: 0.01 },
  });
  if (riskError) throw new Error(riskError.message);
}

async function groceryContext(label: string): Promise<DomainContext & { payments: GroceryPaymentProvider }> {
  const email = `${label}-${crypto.randomUUID().slice(0, 8)}@test.agentledger.dev`;
  const { data, error } = await db.auth.admin.createUser({
    email,
    password: "test-password-123",
    email_confirm: true,
  });
  if (error || !data.user) throw error ?? new Error("grocery test user missing");
  const principalId = data.user.id;
  const agentId = await ensurePrincipalSetup(db, principalId, label);
  await db
    .from("delegations")
    .update({
      max_amount_cents: 8000,
      daily_limit_cents: 15000,
      approval_threshold_cents: 4000,
      allowed_merchants: ["freshcart", "valuemart"],
      allowed_categories: ["grocery"],
      blocked_categories: ["crypto", "gift_card", "wire_transfer"],
      scenario: "grocery",
      min_trust_score: 95,
      require_verified_merchant: true,
    })
    .eq("principal_id", principalId)
    .eq("agent_id", agentId);
  await db.from("grocery_lists").delete().eq("principal_id", principalId);
  await seedCleanRisk(principalId, MILK_PRODUCT_ID);
  await seedCleanRisk(principalId, COFFEE_PRODUCT_ID);
  return {
    db,
    principalId,
    agentId,
    payments: new GroceryPaymentProvider(),
    channel: "grocery-test",
  };
}

beforeAll(async () => {
  const env = localEnv();
  db = createClient(env.url, env.serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { count, error } = await db
    .from("products")
    .select("id", { count: "exact", head: true })
    .eq("category", "grocery");
  if (error) throw error;
  if ((count ?? 0) < 24) {
    throw new Error("Grocery catalog missing — reset the local Supabase database to apply grocery fixtures.");
  }
});

describe("grocery autopilot", () => {
  it("plans the trusted option, exposes a cheaper untrusted listing, and auto-buys a small line", async () => {
    const ctx = await groceryContext("grocery-milk");
    const { data: item, error } = await ctx.db
      .from("grocery_lists")
      .insert({
        principal_id: ctx.principalId,
        item_name: "Milk",
        quantity: 1,
        unit: "gallon",
        staple: false,
        frequency_days: 7,
      })
      .select("*")
      .single();
    if (error || !item) throw error ?? new Error("milk list item missing");

    const plan = await planBasket(ctx);
    expect(plan.basket).toHaveLength(1);
    expect(plan.basket[0]?.product_id).toBe(MILK_PRODUCT_ID);
    expect(plan.basket[0]?.merchant_slug).toBe("freshcart");
    expect(plan.basket[0]?.skipped_cheaper_untrusted?.merchant_name).toBe("DealzDirect");

    const result = await checkout(ctx, {
      lines: [{ grocery_list_id: item.id, product_id: MILK_PRODUCT_ID, quantity: 1 }],
    });
    expect(result.results[0]?.outcome).toBe("auto_bought");
    expect(ctx.payments.calls).toHaveLength(1);

    const { data: refreshed } = await ctx.db.from("grocery_lists").select("last_bought_at").eq("id", item.id).single();
    expect(refreshed?.last_bought_at).toBeTruthy();
  });

  it("drops a lower-priority extra to honor the weekly budget", async () => {
    const ctx = await groceryContext("grocery-budget");
    await ctx.db.from("grocery_settings").update({ weekly_budget_cents: 500 }).eq("principal_id", ctx.principalId);
    await ctx.db.from("grocery_lists").insert([
      {
        principal_id: ctx.principalId,
        item_name: "Milk",
        quantity: 1,
        unit: "gallon",
        staple: true,
        frequency_days: 7,
      },
      {
        principal_id: ctx.principalId,
        item_name: "Coffee",
        quantity: 1,
        unit: "bag",
        staple: false,
        frequency_days: 7,
      },
    ]);

    const plan = await planBasket(ctx);
    expect(plan.basket.map((line) => line.item_name)).toEqual(["Milk"]);
    expect(plan.dropped.find((item) => item.item_name === "Coffee")?.reason).toMatch(/lower-priority extra/i);
    expect(plan.basket_total_cents).toBeLessThanOrEqual(plan.available_budget_cents);
  });

  it("sends a pricier grocery line to human approval instead of charging", async () => {
    const ctx = await groceryContext("grocery-approval");
    const { data: item, error } = await ctx.db
      .from("grocery_lists")
      .insert({
        principal_id: ctx.principalId,
        item_name: "Coffee",
        quantity: 4,
        unit: "bag",
        staple: false,
        frequency_days: 7,
      })
      .select("*")
      .single();
    if (error || !item) throw error ?? new Error("coffee list item missing");

    const plan = await planBasket(ctx);
    const coffee = plan.basket.find((line) => line.item_name === "Coffee");
    expect(coffee?.line_total_cents).toBe(4796);

    const result = await checkout(ctx, {
      lines: [{ grocery_list_id: item.id, product_id: COFFEE_PRODUCT_ID, quantity: 4 }],
    });
    expect(result.results[0]?.outcome).toBe("waiting");
    expect(result.results[0]?.approval_id).toBeTruthy();
    expect(ctx.payments.calls).toHaveLength(0);
  });
});

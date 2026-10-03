// External (unverified website) purchase tests against the local Supabase stack (run `pnpm db:reset` first).
// Deterministic offline: merchants are pre-inserted with fresh trust rows so no live ScamAdviser
// scrape happens, and the Jev risk cache is seeded so the external rule is isolated.
import { execSync } from "node:child_process";
import { beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  checkMerchant,
  parseExternalUrl,
  proposeExternalPurchase,
} from "@/lib/domain/external";
import { ensurePrincipalSetup, resolveApproval, type DomainContext } from "@/lib/domain/pipeline";
import { EXTERNAL_REQUIRES_HUMAN, UNVERIFIED_PRICE_LABEL } from "@/lib/policy/guardrails";
import { contentHash, type AssessListingInput } from "@/lib/risk/jev";
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
const runId = crypto.randomUUID().slice(0, 8);

async function makeUser(label: string): Promise<DomainContext & { payments: CountingProvider }> {
  const email = `${label}-${crypto.randomUUID().slice(0, 8)}@test.agentledger.dev`;
  const { data, error } = await db.auth.admin.createUser({ email, password: "test-password-123", email_confirm: true });
  if (error || !data.user) throw error ?? new Error("no user");
  const agentId = await ensurePrincipalSetup(db, data.user.id, label);
  return { db, principalId: data.user.id, agentId, payments: new CountingProvider(), channel: "test" };
}

/** Pre-insert a merchant with a FRESH live-source trust row so refreshMerchantTrust never hits the network. */
async function seedMerchant(input: {
  domain: string;
  trustScore: number;
  trusted?: boolean;
  verified?: boolean;
}): Promise<{ id: string; slug: string }> {
  const now = new Date().toISOString();
  const slug = input.domain.replace(/\./g, "-");
  const { data, error } = await db
    .from("merchants")
    .insert({
      slug,
      name: `Shop ${input.domain}`,
      domain: input.domain,
      trusted: input.trusted ?? false,
      verified: input.verified ?? false,
      verified_at: input.verified ? now : null,
      trust_score: input.trustScore,
      trust_score_source: "scamadvisor",
      trust_scored_at: now,
    })
    .select("id, slug")
    .single();
  if (error || !data) throw error ?? new Error("merchant seed failed");
  return { id: String(data.id), slug: String(data.slug) };
}

beforeAll(async () => {
  const env = localEnv();
  db = createClient(env.url, env.serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
});

describe("parseExternalUrl (SSRF-safe URL handling)", () => {
  it("accepts only https URLs with public hostnames", () => {
    const ok = parseExternalUrl("https://www.Shop.Example.com/products/desk?x=1");
    expect(ok).toMatchObject({ ok: true, domain: "shop.example.com" });

    expect(parseExternalUrl("http://shop.example.com/desk").ok).toBe(false);
    expect(parseExternalUrl("javascript:alert(1)").ok).toBe(false);
    expect(parseExternalUrl("not a url").ok).toBe(false);
    expect(parseExternalUrl("https://user:pw@shop.example.com/desk").ok).toBe(false);
    expect(parseExternalUrl("https://127.0.0.1/admin").ok).toBe(false);
    expect(parseExternalUrl("https://[::1]/admin").ok).toBe(false);
    expect(parseExternalUrl("https://localhost/admin").ok).toBe(false);
    expect(parseExternalUrl("https://intranet/payroll").ok).toBe(false);
  });
});

describe("check_merchant", () => {
  it("rejects invalid domains", async () => {
    const result = await checkMerchant({ db }, { domain: "localhost" });
    expect(result.status).toBe("invalid_domain");
    const empty = await checkMerchant({ db }, {});
    expect(empty.status).toBe("invalid_domain");
  });

  it("reports a seeded fixture merchant with its stored score and policy preview", async () => {
    const result = await checkMerchant({ db }, { domain: "acme-api.dev" });
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.domain).toBe("acme-api.dev");
    expect(result.scamadviser.score).toBe(98);
    expect(result.scamadviser.source).toBe("fixture");
    expect(result.would_pass_default_policy).toBe(true);
    expect(result.merchant?.slug).toBe("acme-api");
  });

  it("reports a verified merchant as buying via the verified catalog", async () => {
    const domain = `verified-${runId}.example`;
    await seedMerchant({ domain, trustScore: 97, verified: true });
    const result = await checkMerchant({ db }, { domain: `https://${domain}/somewhere` });
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.agentledger_verified).toBe(true);
    expect(result.how_agents_buy).toBe("verified catalog");
  });
});

describe("propose_external_purchase", () => {
  it("rejects invalid input and non-https URLs without creating anything", async () => {
    const ctx = await makeUser("ext-invalid");
    const badUrl = await proposeExternalPurchase(ctx, {
      url: "http://shop.example.com/desk",
      item_name: "Desk",
      claimed_price_cents: 900,
    });
    expect(badUrl.status).toBe("rejected");
    const badInput = await proposeExternalPurchase(ctx, { url: "https://shop.example.com/desk" });
    expect(badInput.status).toBe("rejected");
    expect(ctx.payments.calls).toHaveLength(0);
  });

  it("refuses external purchases for verified merchants (use the catalog instead)", async () => {
    const domain = `verified-ext-${runId}.example`;
    await seedMerchant({ domain, trustScore: 97, verified: true });
    const ctx = await makeUser("ext-verified");
    const result = await proposeExternalPurchase(ctx, {
      url: `https://${domain}/item/1`,
      item_name: "Catalog Item",
      claimed_price_cents: 900,
    });
    expect(result).toMatchObject({ status: "rejected", error: "MERCHANT_VERIFIED" });
  });

  it("creates the unverified merchant + external product and denies under the default policy", async () => {
    const domain = `shop-${runId}.example`;
    const merchant = await seedMerchant({ domain, trustScore: 97 });
    const ctx = await makeUser("ext-deny");
    const url = `https://${domain}/products/standing-desk`;

    const result = await proposeExternalPurchase(ctx, {
      url,
      item_name: "Standing Desk",
      claimed_price_cents: 1500,
      reason: "User asked for this exact desk",
    });

    expect(result.status).toBe("denied");
    if (result.status !== "denied") return;
    // Base merchant allowlist + external website allowlist both deny by default.
    expect(result.violations).toContain("MERCHANT_NOT_ALLOWED");
    expect(result.violations).toContain("WEBSITE_NOT_ALLOWED");
    // EXTERNAL_REQUIRES_HUMAN forces approval but is never a violation.
    expect(result.violations.map(String)).not.toContain(EXTERNAL_REQUIRES_HUMAN);
    expect(result.authoritative.amount_cents).toBe(1500);
    expect(result.external).toMatchObject({
      domain,
      source_url: url,
      merchant_slug: merchant.slug,
      agentledger_verified: false,
      price_label: UNVERIFIED_PRICE_LABEL,
      requires_human: true,
    });
    expect(result.external?.trust.score).toBe(97);
    expect(ctx.payments.calls).toHaveLength(0);

    const { data: product } = await db
      .from("products")
      .select("id, source, external_url, price_cents, market_price_cents, recurring, currency, active")
      .eq("merchant_id", merchant.id)
      .eq("external_url", url)
      .single();
    expect(product).toMatchObject({
      source: "external",
      external_url: url,
      price_cents: 1500,
      market_price_cents: null,
      recurring: false,
      currency: "usd",
      active: true,
    });
  });

  it("never auto-approves an external purchase the human allowed — it always waits for approval", async () => {
    const domain = `allowed-${runId}.example`;
    const merchant = await seedMerchant({ domain, trustScore: 97 });
    const ctx = await makeUser("ext-approve");
    const url = `https://${domain}/products/desk-lamp`;

    // The human allows this domain and merchant; $9.00 is well below the $10 approval threshold,
    // so a catalog purchase would auto-execute.
    const { error: delegationError } = await db
      .from("delegations")
      .update({
        allowed_merchants: ["acme-api", "vectorbase", "devhost", merchant.slug],
        allowed_domains: [domain],
      })
      .eq("principal_id", ctx.principalId);
    expect(delegationError).toBeNull();

    const first = await proposeExternalPurchase(ctx, {
      url,
      item_name: "Desk Lamp",
      claimed_price_cents: 900,
    });
    expect(first.status).toBe("awaiting_approval");
    if (first.status !== "awaiting_approval") return;
    expect(first.external?.requires_human).toBe(true);

    // Seed the Jev risk cache with clean scores so the SECOND proposal has risk signals present —
    // proving require_approval comes from EXTERNAL_REQUIRES_HUMAN alone, not from missing signals.
    const { data: productRow } = await db
      .from("products")
      .select(
        "id, name, description, metadata, price_cents, currency, recurring, merchants!inner(name, domain, trust_score, trust_score_source, verified)",
      )
      .eq("id", first.authoritative.product_id)
      .single();
    expect(productRow).toBeTruthy();
    if (!productRow) return;
    const merchantInfo = productRow.merchants as unknown as {
      name: string;
      domain: string | null;
      trust_score: number | string | null;
      trust_score_source: string | null;
      verified: boolean | null;
    };
    const metadata = productRow.metadata as Record<string, unknown>;
    const rpm = metadata?.requests_per_month;
    // Mirror resolveMerchantTrust: the seeded trust row is fresh, so runtime uses the stored values.
    const trustSource = merchantInfo.trust_score_source;
    const listing: AssessListingInput = {
      productName: String(productRow.name),
      merchantName: merchantInfo.name,
      merchantDomain: merchantInfo.domain ?? null,
      description: String(productRow.description),
      metadata,
      priceCents: Number(productRow.price_cents),
      currency: String(productRow.currency),
      recurring: Boolean(productRow.recurring),
      requestsPerMonth: typeof rpm === "number" ? rpm : null,
      merchantTrustScore:
        merchantInfo.trust_score === null || merchantInfo.trust_score === undefined ? null : Number(merchantInfo.trust_score),
      merchantTrustSource: trustSource === "scamadvisor" || trustSource === "fixture" ? trustSource : "unavailable",
      merchantVerified: merchantInfo.verified === true,
    };
    const hash = await contentHash(listing);
    const { error: riskError } = await db.from("risk_assessments").insert({
      principal_id: ctx.principalId,
      intent_id: null,
      product_id: productRow.id,
      provider: "jev",
      model: "jev-test",
      prompt_injection: 0.01,
      crypto_exfiltration: 0.01,
      price_anomaly: 0.01,
      content_hash: hash,
      raw: { seeded_by: "external.test.ts", merchant_risk: 0.01 },
    });
    expect(riskError).toBeNull();

    const second = await proposeExternalPurchase(ctx, {
      url,
      item_name: "Desk Lamp",
      claimed_price_cents: 900,
    });
    expect(second.status).toBe("awaiting_approval");
    if (second.status !== "awaiting_approval") return;
    // The external product row is reused, not duplicated.
    expect(second.authoritative.product_id).toBe(first.authoritative.product_id);

    const { data: decision } = await db
      .from("policy_decisions")
      .select("decision, violations, rules_evaluated")
      .eq("intent_id", second.intent_id)
      .single();
    expect(decision?.decision).toBe("require_approval");
    expect(decision?.violations).toEqual([]);
    const rules = decision?.rules_evaluated as {
      risk_signals: unknown;
      guardrails: { external_source?: { external: boolean; requiresHuman: boolean; reason: string } };
    };
    expect(rules.risk_signals).not.toBeNull();
    expect(rules.guardrails.external_source).toMatchObject({
      external: true,
      requiresHuman: true,
      reason: EXTERNAL_REQUIRES_HUMAN,
    });

    // The human approves → it executes exactly once.
    const resolved = await resolveApproval(ctx, second.approval_id, "approved", "price checked by human");
    expect(resolved.resolved).toBe(true);
    expect(resolved.execution?.status).toBe("executed");
    expect(ctx.payments.calls).toHaveLength(1);
    expect(ctx.payments.calls[0]?.amountCents).toBe(900);
  });

  it("check_merchant reports external merchants as the unverified fallback", async () => {
    const domain = `shop-${runId}.example`;
    const result = await checkMerchant({ db }, { domain });
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.agentledger_verified).toBe(false);
    expect(result.how_agents_buy).toBe("unverified fallback (human approval required)");
    expect(result.scamadviser.score).toBe(97);
  });
});

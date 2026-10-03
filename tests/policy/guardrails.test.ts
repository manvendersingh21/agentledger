import { describe, expect, it } from "vitest";
import {
  EXTERNAL_REQUIRES_HUMAN,
  evaluateGuardrails,
  externalDomainAllowed,
  MERCHANT_RISK_DENY_THRESHOLD,
  UNVERIFIED_PRICE_LABEL,
  type GuardrailInput,
} from "../../lib/policy/guardrails.ts";
import {
  isExternalProduct,
  reconcileExternalMerchantViolations,
  runGuardrails,
  type RiskSignals,
} from "../../lib/domain/guardrail-gate.ts";
import type { ProductRow } from "../../lib/domain/products.ts";
import type { ViolationCode } from "../../lib/policy/types.ts";

const basePolicy: GuardrailInput["policy"] = {
  minTrustScore: 95,
  trustedDomainOverrides: [],
  priceAnomalyDenyThreshold: 0.8,
  priceAnomalyReviewThreshold: 0.5,
  injectionKillThreshold: 0.9,
  killSwitchEnabled: true,
  allowedDomains: [],
  blockedCategories: ["crypto", "gift_card", "wire_transfer"],
  allowedCategories: [],
  marketPriceTolerance: 1.5,
};

const baseInput: GuardrailInput = {
  agentStatus: "active",
  merchant: { slug: "acme-api", domain: "acme-api.dev", trustScore: 98, trustSource: "fixture" },
  purchase: { category: "software", unitPriceCents: 1500, quantity: 1, external: false },
  productMarketPriceCents: 1500,
  policy: basePolicy,
  risk: { promptInjection: 0.1, cryptoExfiltration: 0.1, priceAnomaly: 0.1 },
};

describe("evaluateGuardrails", () => {
  it("denies when the agent is suspended", () => {
    const result = evaluateGuardrails({ ...baseInput, agentStatus: "suspended" });
    expect(result.violations).toContain("AGENT_SUSPENDED");
    expect(result.checks.agent_active.passed).toBe(false);
  });

  it("passes merchant trust when domain is in overrides despite low score", () => {
    const result = evaluateGuardrails({
      ...baseInput,
      merchant: { slug: "evil-cloud", domain: "evil-cloud-deals.xyz", trustScore: 12, trustSource: "fixture" },
      policy: { ...basePolicy, trustedDomainOverrides: ["evil-cloud-deals.xyz"] },
    });
    expect(result.violations.filter((v) => v.startsWith("MERCHANT_TRUST"))).toEqual([]);
    expect(result.checks.merchant_trust.passed).toBe(true);
    expect(result.checks.merchant_trust.overrideApplied).toBe(true);
  });

  it("denies unknown merchant trust score", () => {
    const result = evaluateGuardrails({
      ...baseInput,
      merchant: { ...baseInput.merchant, trustScore: null, trustSource: "unavailable" },
    });
    expect(result.violations).toContain("MERCHANT_TRUST_UNKNOWN");
  });

  it("denies when trust score is below minimum", () => {
    const result = evaluateGuardrails({
      ...baseInput,
      merchant: { slug: "cheapcompute", domain: "cheapcompute.net", trustScore: 91, trustSource: "fixture" },
    });
    expect(result.violations).toContain("MERCHANT_TRUST_TOO_LOW");
  });

  it("detects prompt injection at kill threshold", () => {
    const result = evaluateGuardrails({
      ...baseInput,
      risk: { promptInjection: 0.9, cryptoExfiltration: 0.1, priceAnomaly: 0.1 },
    });
    expect(result.violations).toContain("PROMPT_INJECTION_DETECTED");
    expect(result.killSwitch.trigger).toBe(true);
    expect(result.killSwitch.reason).toMatch(/promptInjection 0\.9/);
  });

  it("detects crypto exfiltration at kill threshold", () => {
    const result = evaluateGuardrails({
      ...baseInput,
      risk: { promptInjection: 0.1, cryptoExfiltration: 0.95, priceAnomaly: 0.1 },
    });
    expect(result.violations).toContain("CRYPTO_EXFILTRATION_DETECTED");
    expect(result.killSwitch.trigger).toBe(true);
    expect(result.killSwitch.reason).toMatch(/cryptoExfiltration 0\.95/);
  });

  it("denies price anomaly at deny threshold", () => {
    const result = evaluateGuardrails({
      ...baseInput,
      risk: { promptInjection: 0.1, cryptoExfiltration: 0.1, priceAnomaly: 0.85 },
    });
    expect(result.violations).toContain("PRICE_ANOMALY");
  });

  it("requires approval for price anomaly at review threshold only", () => {
    const result = evaluateGuardrails({
      ...baseInput,
      risk: { promptInjection: 0.1, cryptoExfiltration: 0.1, priceAnomaly: 0.55 },
    });
    expect(result.violations).not.toContain("PRICE_ANOMALY");
    expect(result.requireApproval).toBe(true);
    expect(result.checks.price_anomaly.requiresReview).toBe(true);
  });

  it("requires approval when Jev risk is unavailable", () => {
    const result = evaluateGuardrails({ ...baseInput, risk: null });
    expect(result.requireApproval).toBe(true);
    expect(result.checks.jev_available.passed).toBe(false);
    expect(result.violations).toEqual([]);
    expect(result.checks.merchant_risk).toMatchObject({ passed: true, skipped: true });
  });

  it("denies MERCHANT_RISK_HIGH when Jev merchantRisk reaches the threshold", () => {
    const result = evaluateGuardrails({
      ...baseInput,
      risk: { promptInjection: 0.1, cryptoExfiltration: 0.1, priceAnomaly: 0.1, merchantRisk: 0.97 },
    });
    expect(result.violations).toContain("MERCHANT_RISK_HIGH");
    expect(result.checks.merchant_risk).toMatchObject({
      passed: false,
      score: 0.97,
      threshold: MERCHANT_RISK_DENY_THRESHOLD,
      available: true,
    });
    // merchantRisk denies but never triggers the kill switch (only injection/crypto do).
    expect(result.killSwitch.trigger).toBe(false);
  });

  it("denies MERCHANT_RISK_HIGH exactly at the threshold boundary", () => {
    const at = evaluateGuardrails({
      ...baseInput,
      risk: { promptInjection: 0.1, cryptoExfiltration: 0.1, priceAnomaly: 0.1, merchantRisk: MERCHANT_RISK_DENY_THRESHOLD },
    });
    expect(at.violations).toContain("MERCHANT_RISK_HIGH");

    const below = evaluateGuardrails({
      ...baseInput,
      risk: { promptInjection: 0.1, cryptoExfiltration: 0.1, priceAnomaly: 0.1, merchantRisk: 0.89 },
    });
    expect(below.violations).not.toContain("MERCHANT_RISK_HIGH");
    expect(below.checks.merchant_risk.passed).toBe(true);
  });

  it("skips the merchant risk rule when the signal is absent (cached pre-merchantRisk assessment)", () => {
    const result = evaluateGuardrails({
      ...baseInput,
      risk: { promptInjection: 0.1, cryptoExfiltration: 0.1, priceAnomaly: 0.1 },
    });
    expect(result.violations).not.toContain("MERCHANT_RISK_HIGH");
    expect(result.checks.merchant_risk).toMatchObject({ passed: true, available: false, score: null });
  });

  it("does not trigger kill switch when disabled despite injection", () => {
    const result = evaluateGuardrails({
      ...baseInput,
      policy: { ...basePolicy, killSwitchEnabled: false },
      risk: { promptInjection: 0.99, cryptoExfiltration: 0.1, priceAnomaly: 0.1 },
    });
    expect(result.violations).toContain("PROMPT_INJECTION_DETECTED");
    expect(result.killSwitch.trigger).toBe(false);
    expect(result.killSwitch.reason).toBeNull();
  });

  it("clears all guardrails on a healthy proposal", () => {
    const result = evaluateGuardrails(baseInput);
    expect(result.violations).toEqual([]);
    expect(result.requireApproval).toBe(false);
    expect(result.killSwitch.trigger).toBe(false);
  });

  it("does not restrict websites when allowedDomains is empty", () => {
    const result = evaluateGuardrails({
      ...baseInput,
      merchant: { slug: "evil-cloud", domain: "evil-cloud-deals.xyz", trustScore: 12, trustSource: "fixture" },
      policy: { ...basePolicy, allowedDomains: [], trustedDomainOverrides: ["evil-cloud-deals.xyz"] },
    });
    expect(result.violations).not.toContain("WEBSITE_NOT_ALLOWED");
    expect(result.checks.allowed_websites.passed).toBe(true);
  });

  it("allows exact hostname and subdomains when listed", () => {
    const policy = { ...basePolicy, allowedDomains: ["acme-api.dev"] };
    const exact = evaluateGuardrails({
      ...baseInput,
      policy,
    });
    expect(exact.violations).not.toContain("WEBSITE_NOT_ALLOWED");

    const subdomain = evaluateGuardrails({
      ...baseInput,
      merchant: { ...baseInput.merchant, domain: "api.acme-api.dev" },
      policy,
    });
    expect(subdomain.violations).not.toContain("WEBSITE_NOT_ALLOWED");
    expect(subdomain.checks.allowed_websites.passed).toBe(true);
  });

  it("denies WEBSITE_NOT_ALLOWED when domain is not on the list", () => {
    const result = evaluateGuardrails({
      ...baseInput,
      merchant: { slug: "vectorbase", domain: "vectorbase.io", trustScore: 97, trustSource: "fixture" },
      policy: { ...basePolicy, allowedDomains: ["acme-api.dev"] },
    });
    expect(result.violations).toContain("WEBSITE_NOT_ALLOWED");
    expect(result.checks.allowed_websites.passed).toBe(false);
  });

  it("denies CATEGORY_BLOCKED for blocked categories", () => {
    const result = evaluateGuardrails({
      ...baseInput,
      purchase: { category: "crypto", unitPriceCents: 10000, quantity: 1, external: false },
    });
    expect(result.violations).toContain("CATEGORY_BLOCKED");
  });

  it("denies CATEGORY_NOT_ALLOWED when allowlist is non-empty and category missing", () => {
    const result = evaluateGuardrails({
      ...baseInput,
      purchase: { category: "diy_tools", unitPriceCents: 7900, quantity: 1, external: false },
      policy: { ...basePolicy, allowedCategories: ["home_appliance"] },
    });
    expect(result.violations).toContain("CATEGORY_NOT_ALLOWED");
  });

  it("allows any non-blocked category when allowed_categories is empty", () => {
    const result = evaluateGuardrails({
      ...baseInput,
      purchase: { category: "restaurant_food", unitPriceCents: 4200, quantity: 2, external: false },
      policy: { ...basePolicy, allowedCategories: [] },
    });
    expect(result.violations).not.toContain("CATEGORY_NOT_ALLOWED");
  });

  it("denies PRICE_ABOVE_MARKET when unit price exceeds tolerance × market", () => {
    const result = evaluateGuardrails({
      ...baseInput,
      purchase: { category: "software", unitPriceCents: 5000, quantity: 1, external: false },
      productMarketPriceCents: 1500,
      policy: { ...basePolicy, marketPriceTolerance: 1.5 },
    });
    expect(result.violations).toContain("PRICE_ABOVE_MARKET");
    expect(result.checks.market_price.passed).toBe(false);
  });

  it("skips PRICE_ABOVE_MARKET when market price is unknown", () => {
    const result = evaluateGuardrails({
      ...baseInput,
      purchase: { category: "software", unitPriceCents: 999999, quantity: 1, external: false },
      productMarketPriceCents: null,
    });
    expect(result.violations).not.toContain("PRICE_ABOVE_MARKET");
  });

  it("does not force approval for clean non-external purchases", () => {
    const result = evaluateGuardrails(baseInput);
    expect(result.requireApproval).toBe(false);
    expect(result.requireApprovalReasons).toEqual([]);
  });
});

const externalBase: GuardrailInput = {
  ...baseInput,
  merchant: { slug: "shop-example-com", domain: "shop.example.com", trustScore: 97, trustSource: "scamadvisor" },
  purchase: { category: "software", unitPriceCents: 900, quantity: 1, external: true },
  productMarketPriceCents: null,
};

describe("evaluateGuardrails — external (unverified website) purchases", () => {
  it("EXTERNAL_REQUIRES_HUMAN forces require_approval but is not a violation", () => {
    const result = evaluateGuardrails({
      ...externalBase,
      policy: { ...basePolicy, allowedDomains: ["shop.example.com"] },
    });
    expect(result.violations).toEqual([]);
    expect(result.requireApproval).toBe(true);
    expect(result.requireApprovalReasons).toContain(EXTERNAL_REQUIRES_HUMAN);
    expect(result.checks.external_source).toMatchObject({
      passed: true,
      external: true,
      requiresHuman: true,
      reason: EXTERNAL_REQUIRES_HUMAN,
      priceLabel: UNVERIFIED_PRICE_LABEL,
    });
  });

  it("denies WEBSITE_NOT_ALLOWED for external domains even when the allowlist is empty", () => {
    const result = evaluateGuardrails(externalBase);
    expect(result.violations).toContain("WEBSITE_NOT_ALLOWED");
    expect(result.checks.allowed_websites.passed).toBe(false);
  });

  it("passes the website rule when the external domain is in allowed_domains", () => {
    const result = evaluateGuardrails({
      ...externalBase,
      policy: { ...basePolicy, allowedDomains: ["shop.example.com"] },
    });
    expect(result.violations).not.toContain("WEBSITE_NOT_ALLOWED");
  });

  it("passes the website rule when the external domain is in trusted_domain_overrides", () => {
    const result = evaluateGuardrails({
      ...externalBase,
      policy: { ...basePolicy, trustedDomainOverrides: ["shop.example.com"] },
    });
    expect(result.violations).not.toContain("WEBSITE_NOT_ALLOWED");
  });

  it("lets allowed_domains satisfy the trust rule for external domains with a low/unknown score", () => {
    const result = evaluateGuardrails({
      ...externalBase,
      merchant: { ...externalBase.merchant, trustScore: null, trustSource: "unavailable" },
      policy: { ...basePolicy, allowedDomains: ["shop.example.com"] },
    });
    expect(result.violations.filter((v) => v.startsWith("MERCHANT_TRUST"))).toEqual([]);
    expect(result.violations).toEqual([]);
    expect(result.requireApproval).toBe(true);
  });

  it("still denies external purchases on trust when the domain was never allowed", () => {
    const result = evaluateGuardrails({
      ...externalBase,
      merchant: { ...externalBase.merchant, trustScore: 40, trustSource: "scamadvisor" },
    });
    expect(result.violations).toContain("MERCHANT_TRUST_TOO_LOW");
    expect(result.violations).toContain("WEBSITE_NOT_ALLOWED");
  });

  it("keeps category/kill-switch deny rules for external purchases", () => {
    const blocked = evaluateGuardrails({
      ...externalBase,
      purchase: { ...externalBase.purchase, category: "gift_card" },
      policy: { ...basePolicy, allowedDomains: ["shop.example.com"] },
    });
    expect(blocked.violations).toContain("CATEGORY_BLOCKED");

    const injected = evaluateGuardrails({
      ...externalBase,
      policy: { ...basePolicy, allowedDomains: ["shop.example.com"] },
      risk: { promptInjection: 0.95, cryptoExfiltration: 0.1, priceAnomaly: 0.1 },
    });
    expect(injected.violations).toContain("PROMPT_INJECTION_DETECTED");
    expect(injected.killSwitch.trigger).toBe(true);
  });

  it("never reports EXTERNAL_REQUIRES_HUMAN among violations", () => {
    const denied = evaluateGuardrails(externalBase);
    expect(denied.violations).not.toContain(EXTERNAL_REQUIRES_HUMAN as unknown as (typeof denied.violations)[number]);
  });
});

function productFixture(overrides: {
  source?: string | null;
  trusted?: boolean;
  verified?: boolean;
  trustSource?: string;
  domain?: string | null;
}): ProductRow {
  return {
    id: "00000000-0000-4000-8000-00000000000a",
    merchant_id: "00000000-0000-4000-8000-00000000000b",
    name: "Standing Desk",
    description: "An item",
    price_cents: 900,
    currency: "usd",
    recurring: false,
    metadata: {},
    active: true,
    category: "software",
    attributes: {},
    market_price_cents: null,
    image_emoji: null,
    merchants: {
      id: "00000000-0000-4000-8000-00000000000b",
      slug: "shop-example-com",
      name: "shop.example.com",
      trusted: overrides.trusted ?? false,
      domain: overrides.domain === undefined ? "shop.example.com" : overrides.domain,
      trust_score: 97,
      trust_score_source: overrides.trustSource ?? "scamadvisor",
      verified: overrides.verified ?? false,
    },
    ...(overrides.source !== undefined ? { source: overrides.source } : {}),
  } as ProductRow;
}

describe("guardrail-gate external helpers", () => {
  it("isExternalProduct follows products.source when present", () => {
    expect(isExternalProduct(productFixture({ source: "external" }))).toBe(true);
    expect(isExternalProduct(productFixture({ source: "catalog" }))).toBe(false);
    expect(isExternalProduct(productFixture({ source: "merchant_feed", verified: true }))).toBe(false);
  });

  it("isExternalProduct fails toward external for unverified, untrusted, non-fixture merchants", () => {
    expect(isExternalProduct(productFixture({}))).toBe(true);
    expect(isExternalProduct(productFixture({ trusted: true }))).toBe(false);
    expect(isExternalProduct(productFixture({ verified: true }))).toBe(false);
    expect(isExternalProduct(productFixture({ trustSource: "fixture" }))).toBe(false);
  });

  it("reconcileExternalMerchantViolations drops MERCHANT_NOT_ALLOWED only for allowed external domains", () => {
    const violations: ViolationCode[] = ["MERCHANT_NOT_ALLOWED", "TRANSACTION_LIMIT_EXCEEDED"];
    const external = productFixture({ source: "external" });

    expect(reconcileExternalMerchantViolations(external, { allowed_domains: ["shop.example.com"] }, violations)).toEqual([
      "TRANSACTION_LIMIT_EXCEEDED",
    ]);
    expect(
      reconcileExternalMerchantViolations(external, { trusted_domain_overrides: ["shop.example.com"] }, violations),
    ).toEqual(["TRANSACTION_LIMIT_EXCEEDED"]);
    // Domain not allowed: untouched.
    expect(reconcileExternalMerchantViolations(external, { allowed_domains: [] }, violations)).toEqual(violations);
    expect(reconcileExternalMerchantViolations(external, null, violations)).toEqual(violations);
    // Catalog products: untouched.
    expect(
      reconcileExternalMerchantViolations(productFixture({ source: "catalog" }), { allowed_domains: ["shop.example.com"] }, violations),
    ).toEqual(violations);
  });

  it("externalDomainAllowed matches subdomains of allowed_domains and exact overrides", () => {
    const policy = { allowedDomains: ["example.com"], trustedDomainOverrides: ["other.dev"] };
    expect(externalDomainAllowed("shop.example.com", policy)).toBe(true);
    expect(externalDomainAllowed("example.com", policy)).toBe(true);
    expect(externalDomainAllowed("other.dev", policy)).toBe(true);
    expect(externalDomainAllowed("evil.dev", policy)).toBe(false);
    expect(externalDomainAllowed(null, policy)).toBe(false);
  });
});

function riskFixture(overrides: Partial<RiskSignals> = {}): RiskSignals {
  return {
    promptInjection: 0.05,
    cryptoExfiltration: 0.05,
    priceAnomaly: 0.05,
    merchantRisk: 0.05,
    merchantTrustScore: 97,
    merchantTrustSource: "scamadvisor",
    merchantTrustCheckedAt: "2026-10-03T12:00:00.000Z",
    merchantVerified: false,
    provider: "jev",
    model: "jev-latest",
    cached: false,
    ...overrides,
  };
}

describe("runGuardrails — ScamAdviser → Jev merchantRisk → policy chain", () => {
  const cleanProduct = productFixture({ source: "catalog", trusted: true });

  it("passes a clean proposal and records the full risk chain", () => {
    const result = runGuardrails("active", cleanProduct, null, riskFixture(), { quantity: 1 });
    expect(result.violations).toEqual([]);
    expect(result.checks.risk_chain).toMatchObject({
      passed: true,
      scamadviser: { score: 97, source: "scamadvisor", checkedAt: "2026-10-03T12:00:00.000Z" },
      jev: {
        model: "jev-latest",
        promptInjection: 0.05,
        cryptoExfiltration: 0.05,
        priceAnomaly: 0.05,
        merchantRisk: 0.05,
      },
      decision: "pass",
    });
  });

  it("denies on MERCHANT_RISK_HIGH and shows the chain: ScamAdviser 12 → Jev merchantRisk 0.97 → deny", () => {
    const result = runGuardrails(
      "active",
      cleanProduct,
      null,
      riskFixture({ merchantRisk: 0.97, merchantTrustScore: 12 }),
      { quantity: 1 },
    );
    expect(result.violations).toContain("MERCHANT_RISK_HIGH");
    expect(result.checks.risk_chain).toMatchObject({
      passed: false,
      scamadviser: { score: 12, source: "scamadvisor" },
      jev: { merchantRisk: 0.97 },
      decision: "deny",
    });
  });

  it("uses the refreshed trust score from the risk signals over the stale product row", () => {
    // Product row says 97, but the live refresh at assessment time came back 12.
    const result = runGuardrails(
      "active",
      cleanProduct,
      null,
      riskFixture({ merchantTrustScore: 12 }),
      { quantity: 1 },
    );
    expect(result.violations).toContain("MERCHANT_TRUST_TOO_LOW");
    expect(result.checks.merchant_trust).toMatchObject({ passed: false, trustScore: 12 });
  });

  it("falls back to the stored trust row in the chain when Jev is unavailable", () => {
    const result = runGuardrails("active", cleanProduct, null, null, { quantity: 1 });
    expect(result.violations).toEqual([]);
    expect(result.requireApproval).toBe(true);
    expect(result.checks.risk_chain).toMatchObject({
      passed: true,
      scamadviser: { score: 97, source: "scamadvisor", checkedAt: null },
      jev: null,
      decision: "require_approval",
    });
  });
});

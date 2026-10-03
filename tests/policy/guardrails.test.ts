import { describe, expect, it } from "vitest";
import { evaluateGuardrails, type GuardrailInput } from "../../lib/policy/guardrails.ts";

const basePolicy: GuardrailInput["policy"] = {
  minTrustScore: 95,
  trustedDomainOverrides: [],
  priceAnomalyDenyThreshold: 0.8,
  priceAnomalyReviewThreshold: 0.5,
  injectionKillThreshold: 0.9,
  killSwitchEnabled: true,
};

const baseInput: GuardrailInput = {
  agentStatus: "active",
  merchant: { slug: "acme-api", domain: "acme-api.dev", trustScore: 98, trustSource: "fixture" },
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
});

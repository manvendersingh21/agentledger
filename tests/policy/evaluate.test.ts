import { describe, expect, it } from "vitest";
import { describeDelegation, evaluateAction } from "../../lib/policy/evaluate.ts";
import { POLICY_VERSION, type Delegation, type PurchaseIntent } from "../../lib/policy/types.ts";

const delegation: Delegation = {
  id: "delegation", principalId: "principal", agentId: "agent", actionType: "purchase",
  maxAmountCents: 2000, dailyLimitCents: 5000, approvalThresholdCents: 1000,
  allowRecurring: false, allowedMerchants: ["acme-api", "vectorbase", "devhost"], deniedMerchants: [],
  validFrom: "2026-10-01T00:00:00Z", validUntil: null, status: "active",
};
const intent: PurchaseIntent = {
  actionType: "purchase", merchantSlug: "acme-api", productId: "starter",
  amountCents: 1000, currency: "usd", recurring: false,
};
const now = new Date("2026-10-03T12:00:00Z");
const evaluate = (changes: Partial<Parameters<typeof evaluateAction>[0]> = {}) =>
  evaluateAction({ delegation, intent, dailySpendCents: 0, now, ...changes });

describe("deterministic purchase policy", () => {
  it("auto-approves at the inclusive threshold and requires approval above it", () => {
    expect(evaluate()).toMatchObject({ decision: "auto_approve", violations: [], approvalRequired: false, policyVersion: POLICY_VERSION });
    expect(evaluate({ intent: { ...intent, amountCents: 1001 } })).toMatchObject({ decision: "require_approval", violations: [], approvalRequired: true });
    expect(evaluate({ intent: { ...intent, amountCents: 0 } }).decision).toBe("auto_approve");
  });

  it("permits equality at transaction and daily limits, but rejects the next cent", () => {
    expect(evaluate({ intent: { ...intent, amountCents: 2000 }, dailySpendCents: 3000 }).decision).toBe("require_approval");
    expect(evaluate({ intent: { ...intent, amountCents: 2001 } }).violations).toEqual(["TRANSACTION_LIMIT_EXCEEDED"]);
    expect(evaluate({ dailySpendCents: 4001 }).violations).toEqual(["DAILY_LIMIT_EXCEEDED"]);
  });

  it.each([null, { ...delegation, status: "disabled" as const }, { ...delegation, status: "revoked" as const },
    { ...delegation, validFrom: "2026-10-04T00:00:00Z" }, { ...delegation, validUntil: now.toISOString() },
    { ...delegation, validFrom: "invalid" }, { ...delegation, validUntil: "invalid" },
  ])("denies missing, inactive, or invalid delegation %j", (d) => {
    expect(evaluate({ delegation: d })).toMatchObject({ decision: "deny", approvalRequired: false });
    expect(evaluate({ delegation: d }).violations).toContain("NO_ACTIVE_DELEGATION");
  });

  it("includes the start of a delegation's validity window", () => {
    expect(evaluate({ now: new Date(delegation.validFrom) }).decision).toBe("auto_approve");
  });

  it.each([-1, 0.5, NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 1])("rejects invalid amount %s", (amountCents) => {
    expect(evaluate({ intent: { ...intent, amountCents } }).violations).toContain("INVALID_AMOUNT");
  });

  it.each([-1, NaN, Infinity, 0.5])("fails closed on invalid daily spend %s", (dailySpendCents) => {
    expect(evaluate({ dailySpendCents }).violations).toContain("DAILY_LIMIT_EXCEEDED");
  });

  it("denies all merchants with an empty allowlist, and explicit denial wins", () => {
    expect(evaluate({ delegation: { ...delegation, allowedMerchants: [] } }).violations).toEqual(["MERCHANT_NOT_ALLOWED"]);
    expect(evaluate({ delegation: { ...delegation, deniedMerchants: ["acme-api"] } }).violations).toEqual(["MERCHANT_NOT_ALLOWED"]);
    expect(evaluate({ intent: { ...intent, merchantSlug: "ACME-API" } }).decision).toBe("deny");
  });

  it("accepts subscriptions only with explicit permission", () => {
    expect(evaluate({ intent: { ...intent, recurring: true } }).violations).toEqual(["RECURRING_NOT_ALLOWED"]);
    expect(evaluate({ intent: { ...intent, recurring: true }, delegation: { ...delegation, allowRecurring: true } }).decision).toBe("auto_approve");
  });

  it.each(["eur", "USD", "", "usd "])("rejects unsupported currency %s", (currency) => {
    expect(evaluate({ intent: { ...intent, currency } }).violations).toEqual(["CURRENCY_NOT_ALLOWED"]);
  });

  it("evaluates every hard rule in stable order, and denial overrides approval", () => {
    const result = evaluate({
      delegation: { ...delegation, status: "disabled" }, dailySpendCents: 5000,
      intent: { ...intent, actionType: "transfer", amountCents: Infinity, currency: "eur", recurring: true, merchantSlug: "evil-cloud" } as unknown as PurchaseIntent,
    });
    expect(result).toMatchObject({ decision: "deny", approvalRequired: false, violations: [
      "NO_ACTIVE_DELEGATION", "ACTION_NOT_DELEGATED", "INVALID_AMOUNT", "CURRENCY_NOT_ALLOWED",
      "TRANSACTION_LIMIT_EXCEEDED", "DAILY_LIMIT_EXCEEDED", "RECURRING_NOT_ALLOWED", "MERCHANT_NOT_ALLOWED",
    ] });
    expect(result.rules.approval_threshold.passed).toBe(true);
  });

  it("rejects malicious catalog data based on structured amount, recurrence and merchant", () => {
    const result = evaluate({ intent: { ...intent, productId: "evil", merchantSlug: "evil-cloud", amountCents: 50000, recurring: true } });
    expect(result.violations).toEqual(["TRANSACTION_LIMIT_EXCEEDED", "DAILY_LIMIT_EXCEEDED", "RECURRING_NOT_ALLOWED", "MERCHANT_NOT_ALLOWED"]);
  });

  it("denies malformed configuration and catches throwing inputs", () => {
    expect(evaluate({ delegation: { ...delegation, approvalThresholdCents: NaN } }).decision).toBe("deny");
    expect(evaluate({ now: new Date("invalid") }).decision).toBe("deny");
    const throwing = new Proxy(delegation, { get() { throw new Error("bad input"); } });
    expect(evaluate({ delegation: throwing })).toMatchObject({ decision: "deny", approvalRequired: false });
    expect(evaluateAction(null as unknown as Parameters<typeof evaluateAction>[0]).decision).toBe("deny");
  });

  it("records explainable limits and never mutates its inputs", () => {
    const frozen = Object.freeze({ ...delegation, allowedMerchants: [...delegation.allowedMerchants] });
    const result = evaluate({ delegation: frozen, dailySpendCents: 500 });
    expect(result.rules.transaction_limit).toEqual({ limit: 2000, actual: 1000, passed: true });
    expect(result.rules.daily_limit).toEqual({ limit: 5000, spent: 500, requested: 1000, passed: true });
    expect(result).toEqual(evaluate({ delegation: frozen, dailySpendCents: 500 }));
    expect(result.rules.merchant.allowed).not.toBe(frozen.allowedMerchants);
  });

  it("describes the demo delegation and renders optional merchant names", () => {
    expect(describeDelegation(delegation)).toBe("Claude can make one-time purchases from 3 trusted merchants up to $20 per transaction and $50/day. Purchases above $10 require approval.");
    expect(describeDelegation({ ...delegation, allowedMerchants: ["acme-api"], maxAmountCents: 1550 }, { "acme-api": "Acme API" })).toContain("from Acme API up to $15.50");
  });
});

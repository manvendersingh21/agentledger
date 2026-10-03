import {
  POLICY_VERSION,
  type AuthorizationDecision,
  type Delegation,
  type PurchaseIntent,
  type RulesEvaluated,
  type ViolationCode,
} from "./types.ts";

function validCents(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function failedRules(): RulesEvaluated {
  return {
    active_delegation: { passed: false, reason: "Policy evaluation failed closed" },
    transaction_limit: { passed: false },
    daily_limit: { passed: false },
    recurring: { passed: false },
    merchant: { passed: false },
    approval_threshold: { passed: true, requires_approval: false },
  };
}

export function evaluateAction(input: {
  delegation: Delegation | null;
  intent: PurchaseIntent;
  dailySpendCents: number;
  now: Date;
}): AuthorizationDecision {
  try {
    const { delegation: d, intent, dailySpendCents, now } = input;
    const nowMs = now.getTime();
    const from = d ? Date.parse(d.validFrom) : Number.NaN;
    const until = d?.validUntil === null ? Infinity : Date.parse(d?.validUntil ?? "");
    const configured = d !== null
      && validCents(d.maxAmountCents) && d.maxAmountCents > 0
      && validCents(d.dailyLimitCents) && d.dailyLimitCents > 0
      && validCents(d.approvalThresholdCents)
      && typeof d.allowRecurring === "boolean"
      && Array.isArray(d.allowedMerchants) && d.allowedMerchants.every((slug) => typeof slug === "string")
      && Array.isArray(d.deniedMerchants) && d.deniedMerchants.every((slug) => typeof slug === "string");
    const active = configured && d.status === "active" && Number.isFinite(nowMs)
      && Number.isFinite(from) && nowMs >= from && nowMs < until;
    const actionAllowed = intent.actionType === "purchase" && (d === null || d.actionType === "purchase");
    const amountValid = validCents(intent.amountCents);
    const currencyAllowed = intent.currency === "usd";
    const transactionPassed = d !== null && validCents(d.maxAmountCents)
      && amountValid && intent.amountCents <= d.maxAmountCents;
    const dailyPassed = d !== null && validCents(d.dailyLimitCents)
      && validCents(dailySpendCents) && amountValid
      && intent.amountCents <= d.dailyLimitCents - dailySpendCents;
    const recurringPassed = d !== null && typeof intent.recurring === "boolean"
      && (intent.recurring === false || d.allowRecurring === true);
    const merchantPassed = d !== null && typeof intent.merchantSlug === "string"
      && d.allowedMerchants.includes(intent.merchantSlug)
      && !d.deniedMerchants.includes(intent.merchantSlug);
    const requiresApproval = d !== null && intent.amountCents > d.approvalThresholdCents;

    const violations: ViolationCode[] = [];
    if (!active) violations.push("NO_ACTIVE_DELEGATION");
    if (!actionAllowed) violations.push("ACTION_NOT_DELEGATED");
    if (!amountValid) violations.push("INVALID_AMOUNT");
    if (!currencyAllowed) violations.push("CURRENCY_NOT_ALLOWED");
    // A missing delegation has no limits to compare; independent input rules still run.
    if (d !== null && !transactionPassed) violations.push("TRANSACTION_LIMIT_EXCEEDED");
    if ((d !== null && !dailyPassed) || !validCents(dailySpendCents)) violations.push("DAILY_LIMIT_EXCEEDED");
    if (d !== null && !recurringPassed) violations.push("RECURRING_NOT_ALLOWED");
    if (d !== null && !merchantPassed) violations.push("MERCHANT_NOT_ALLOWED");

    const rules: RulesEvaluated = {
      active_delegation: { passed: active, ...(!active ? { reason: "Missing, inactive, invalid, or outside validity window" } : {}) },
      transaction_limit: { limit: d?.maxAmountCents ?? null, actual: intent.amountCents, passed: transactionPassed },
      daily_limit: { limit: d?.dailyLimitCents ?? null, spent: dailySpendCents, requested: intent.amountCents, passed: dailyPassed },
      recurring: { allowed: d?.allowRecurring ?? false, requested: intent.recurring, passed: recurringPassed },
      merchant: { requested: intent.merchantSlug, allowed: [...(d?.allowedMerchants ?? [])], passed: merchantPassed },
      approval_threshold: { threshold: d?.approvalThresholdCents ?? null, actual: intent.amountCents, requires_approval: requiresApproval, passed: true },
    };
    if (violations.length > 0) {
      return { decision: "deny", violations, approvalRequired: false, rules, policyVersion: POLICY_VERSION };
    }
    if (requiresApproval) {
      return { decision: "require_approval", violations: [], approvalRequired: true, rules, policyVersion: POLICY_VERSION };
    }
    return { decision: "auto_approve", violations: [], approvalRequired: false, rules, policyVersion: POLICY_VERSION };
  } catch {
    return {
      decision: "deny",
      violations: ["NO_ACTIVE_DELEGATION"],
      approvalRequired: false,
      rules: failedRules(),
      policyVersion: POLICY_VERSION,
    };
  }
}

export function describeDelegation(d: Delegation, merchantNames?: Record<string, string>): string {
  const money = (cents: number) => `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: cents % 100 === 0 ? 0 : 2, maximumFractionDigits: 2 })}`;
  const merchants = [...new Set(d.allowedMerchants)].filter((slug) => !d.deniedMerchants.includes(slug));
  const merchantLabel = merchantNames
    ? merchants.map((slug) => merchantNames[slug] ?? slug).join(", ") || "no merchants"
    : `${merchants.length} trusted merchant${merchants.length === 1 ? "" : "s"}`;
  if (d.status !== "active") return `Claude cannot make purchases while this delegation is ${d.status}.`;
  return `Claude can make ${d.allowRecurring ? "one-time or recurring" : "one-time"} purchases from ${merchantLabel} up to ${money(d.maxAmountCents)} per transaction and ${money(d.dailyLimitCents)}/day. Purchases above ${money(d.approvalThresholdCents)} require approval.`;
}

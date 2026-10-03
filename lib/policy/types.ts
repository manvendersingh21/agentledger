export type ViolationCode =
  | "NO_ACTIVE_DELEGATION"
  | "TRANSACTION_LIMIT_EXCEEDED"
  | "DAILY_LIMIT_EXCEEDED"
  | "RECURRING_NOT_ALLOWED"
  | "MERCHANT_NOT_ALLOWED"
  | "INVALID_AMOUNT"
  | "CURRENCY_NOT_ALLOWED"
  | "ACTION_NOT_DELEGATED";

export interface Delegation {
  id: string;
  principalId: string;
  agentId: string;
  actionType: "purchase";
  maxAmountCents: number;
  dailyLimitCents: number;
  approvalThresholdCents: number;
  allowRecurring: boolean;
  allowedMerchants: string[];
  deniedMerchants: string[];
  validFrom: string;
  validUntil: string | null;
  status: "active" | "disabled" | "revoked";
}

export interface PurchaseIntent {
  actionType: "purchase";
  merchantSlug: string;
  productId: string;
  amountCents: number;
  currency: string;
  recurring: boolean;
}

export interface RuleResult {
  passed: boolean;
  [k: string]: unknown;
}

export type RulesEvaluated = Record<
  | "active_delegation"
  | "transaction_limit"
  | "daily_limit"
  | "recurring"
  | "merchant"
  | "approval_threshold",
  RuleResult
>;

export type AuthorizationDecision =
  | { decision: "deny"; violations: ViolationCode[]; approvalRequired: false; rules: RulesEvaluated; policyVersion: string }
  | { decision: "auto_approve"; violations: []; approvalRequired: false; rules: RulesEvaluated; policyVersion: string }
  | { decision: "require_approval"; violations: []; approvalRequired: true; rules: RulesEvaluated; policyVersion: string };

export const POLICY_VERSION = "purchase-v1";

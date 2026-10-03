// Row shapes as read through RLS by the dashboard (snake_case = DB columns).
export type IntentStatus =
  | "proposed" | "evaluating" | "denied" | "awaiting_approval" | "approved"
  | "executing" | "executed" | "failed" | "expired" | "duplicate";

export interface IntentRow {
  id: string;
  principal_id: string;
  agent_id: string;
  delegation_id: string | null;
  action_type: string;
  status: IntentStatus;
  payload: {
    product_name?: string;
    merchant_name?: string;
    merchant_trusted?: boolean;
    channel?: string;
    quantity?: number;
    agent_claimed?: { amount_cents?: number; recurring?: boolean; merchant?: string };
    tampered_fields?: string[];
    [k: string]: unknown;
  };
  amount_cents: number;
  currency: string;
  merchant_slug: string;
  product_id: string | null;
  recurring: boolean;
  idempotency_key: string;
  risk_level: "low" | "medium" | "high" | "critical";
  reason: string | null;
  created_at: string;
  updated_at: string;
}

export interface PolicyDecisionRow {
  id: string;
  intent_id: string;
  decision: "deny" | "auto_approve" | "require_approval";
  rules_evaluated: Record<string, { passed: boolean; [k: string]: unknown }>;
  violations: string[];
  approval_required: boolean;
  policy_version: string;
  created_at: string;
}

export interface ApprovalRow {
  id: string;
  intent_id: string;
  principal_id: string;
  status: "pending" | "approved" | "denied" | "expired";
  requested_at: string;
  resolved_at: string | null;
  resolution_reason: string | null;
}

export interface ExecutionRow {
  id: string;
  intent_id: string;
  idempotency_key: string;
  status: "pending" | "succeeded" | "failed";
  provider: string;
  provider_operation_id: string | null;
  started_at: string;
  completed_at: string | null;
  result: Record<string, unknown> | null;
  error: Record<string, unknown> | null;
}

export interface ReceiptRow {
  id: string;
  intent_id: string;
  execution_id: string;
  provider: string;
  provider_reference: string;
  amount_cents: number;
  currency: string;
  receipt_data: Record<string, unknown>;
  created_at: string;
}

export interface AuditEventRow {
  id: string;
  principal_id: string;
  agent_id: string | null;
  intent_id: string | null;
  event_type: string;
  event_data: Record<string, unknown>;
  previous_hash: string;
  event_hash: string;
  created_at: string;
}

export interface DelegationRow {
  id: string;
  principal_id: string;
  agent_id: string;
  action_type: string;
  max_amount_cents: number;
  daily_limit_cents: number;
  approval_threshold_cents: number;
  allow_recurring: boolean;
  allowed_merchants: string[];
  denied_merchants: string[];
  valid_from: string;
  valid_until: string | null;
  status: "active" | "disabled" | "revoked";
  min_trust_score?: number;
  trusted_domain_overrides?: string[];
  price_anomaly_deny_threshold?: number;
  price_anomaly_review_threshold?: number;
  injection_kill_threshold?: number;
  kill_switch_enabled?: boolean;
  require_verified_merchant?: boolean;
  allowed_domains?: string[];
  created_at: string;
  updated_at: string;
}

export interface AgentRow {
  id: string;
  owner_id: string;
  name: string;
  description: string | null;
  agent_type: string;
  status: "active" | "disabled" | "suspended";
  suspended_at?: string | null;
  suspended_reason?: string | null;
  created_at: string;
}

export interface MerchantRow {
  id: string;
  slug: string;
  name: string;
  trusted: boolean;
  domain?: string | null;
  trust_score?: number | null;
  trust_score_source?: string;
  verified?: boolean;
}

export interface PendingApproval {
  approval: ApprovalRow;
  intent: IntentRow;
  decision: PolicyDecisionRow | null;
  agentName: string;
  delegation: DelegationRow | null;
}

export interface Metrics {
  evaluated: number;
  blocked: number;
  humanApprovals: number;
  executed: number;
  spendProtectedCents: number;
  spentCents: number;
  duplicatesBlocked: number;
}

export interface AuditVerification {
  valid: boolean;
  verifiedCount: number;
  brokenAt?: string;
  reason?: string;
}

import "server-only";

import { verifyPrincipalChain } from "@/lib/domain/audit";
import { createClient } from "@/lib/supabase/server";

export type LiveIntentStatus =
  | "proposed"
  | "evaluating"
  | "denied"
  | "awaiting_approval"
  | "approved"
  | "executing"
  | "executed"
  | "failed"
  | "expired"
  | "duplicate";

export interface LiveIntentOption {
  id: string;
  productName: string;
  merchantName: string;
  amountCents: number;
  currency: string;
  status: LiveIntentStatus;
  createdAt: string;
}

export interface LivePolicyRule {
  key: string;
  label: string;
  passed: boolean;
  values: string;
}

export interface LivePipelineSnapshot {
  id: string;
  status: LiveIntentStatus;
  createdAt: string;
  updatedAt: string;
  channel: "playground" | "concierge" | "mcp" | "autopilot";
  agent: {
    name: string;
    type: string;
  };
  intent: {
    productName: string;
    merchantName: string;
    merchantSlug: string;
    amountCents: number;
    currency: string;
    recurring: boolean;
    quantity: number;
    category: string;
  };
  trust: {
    score: number | null;
    source: string;
    checkedAt: string | null;
    domain: string | null;
  };
  jev: {
    available: boolean;
    provider: string | null;
    model: string | null;
    cached: boolean;
    promptInjection: number | null;
    cryptoExfiltration: number | null;
    priceAnomaly: number | null;
    merchantRisk: number | null;
  };
  policy: {
    decision: "deny" | "auto_approve" | "require_approval";
    rules: LivePolicyRule[];
    violations: string[];
    createdAt: string;
  } | null;
  approval: {
    status: "pending" | "approved" | "denied" | "expired";
    intentHash: string | null;
    requestedAt: string;
    resolvedAt: string | null;
  } | null;
  execution: {
    status: "pending" | "succeeded" | "failed";
    provider: string;
    paymentIntentId: string | null;
    startedAt: string;
    completedAt: string | null;
  } | null;
  receipt: {
    id: string;
    provider: string;
    providerReference: string;
    amountCents: number;
    currency: string;
    createdAt: string;
  } | null;
  audit: {
    eventCount: number;
    verified: boolean;
    verifiedCount: number;
    latestHash: string | null;
    reason: string | null;
  };
}

export interface LivePipelineData {
  userId: string;
  selectedIntentId: string | null;
  intents: LiveIntentOption[];
  snapshot: LivePipelineSnapshot | null;
  fetchedAt: string;
}

interface IntentRecord {
  id: string;
  agent_id: string;
  status: LiveIntentStatus;
  payload: Record<string, unknown>;
  amount_cents: number;
  currency: string;
  merchant_slug: string;
  recurring: boolean;
  created_at: string;
  updated_at: string;
}

interface DecisionRecord {
  decision: "deny" | "auto_approve" | "require_approval";
  rules_evaluated: unknown;
  violations: unknown;
  created_at: string;
}

interface ApprovalRecord {
  status: "pending" | "approved" | "denied" | "expired";
  intent_hash: string | null;
  requested_at: string;
  resolved_at: string | null;
}

interface ExecutionRecord {
  status: "pending" | "succeeded" | "failed";
  provider: string;
  provider_operation_id: string | null;
  started_at: string;
  completed_at: string | null;
}

interface ReceiptRecord {
  id: string;
  provider: string;
  provider_reference: string;
  amount_cents: number;
  currency: string;
  created_at: string;
}

interface AgentRecord {
  name: string;
  agent_type: string;
}

interface MerchantRecord {
  name: string;
  domain: string | null;
  trust_score: number | string | null;
  trust_score_source: string | null;
  trust_scored_at: string | null;
}

interface AuditRecord {
  event_hash: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown, fallback: string): string {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function numberValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function booleanValue(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function normalizeChannel(value: unknown): LivePipelineSnapshot["channel"] {
  if (value === "concierge" || value === "mcp" || value === "autopilot") return value;
  return "playground";
}

function humanize(value: string): string {
  return value
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replaceAll("_", " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function compactValue(value: unknown): string | null {
  if (value === null) return "none";
  if (typeof value === "boolean") return value ? "yes" : "no";
  if (typeof value === "number") return Number.isInteger(value) ? String(value) : value.toFixed(2);
  if (typeof value === "string") return value.length > 28 ? `${value.slice(0, 25)}…` : value;
  if (Array.isArray(value)) {
    if (value.length === 0) return "none";
    const primitives = value.filter(
      (entry): entry is string | number | boolean =>
        typeof entry === "string" || typeof entry === "number" || typeof entry === "boolean",
    );
    return primitives.length === value.length
      ? primitives.slice(0, 2).map(String).join(", ") + (value.length > 2 ? ` +${value.length - 2}` : "")
      : `${value.length} values`;
  }
  return null;
}

function summarizeRuleValues(rule: Record<string, unknown>): string {
  const preferredKeys = [
    "actual",
    "limit",
    "spent",
    "requested",
    "threshold",
    "score",
    "trustScore",
    "minTrustScore",
    "status",
    "domain",
    "category",
    "unitPriceCents",
    "ceilingCents",
    "requires_approval",
    "requiresHuman",
  ];
  const orderedKeys = [
    ...preferredKeys.filter((key) => key in rule),
    ...Object.keys(rule).filter((key) => key !== "passed" && !preferredKeys.includes(key)),
  ];
  const parts: string[] = [];
  for (const key of orderedKeys) {
    if (key === "passed" || parts.length >= 2) continue;
    const value = compactValue(rule[key]);
    if (value !== null) parts.push(`${humanize(key)} ${value}`);
  }
  return parts.join(" · ");
}

function flattenRules(value: unknown): LivePolicyRule[] {
  if (!isRecord(value)) return [];
  const result: LivePolicyRule[] = [];

  for (const [key, rawRule] of Object.entries(value)) {
    if (key === "risk_signals") continue;
    if (key === "guardrails" && isRecord(rawRule)) {
      for (const [guardrailKey, rawGuardrail] of Object.entries(rawRule)) {
        if (!isRecord(rawGuardrail) || typeof rawGuardrail.passed !== "boolean") continue;
        result.push({
          key: `guardrails.${guardrailKey}`,
          label: humanize(guardrailKey),
          passed: rawGuardrail.passed,
          values: summarizeRuleValues(rawGuardrail),
        });
      }
      continue;
    }
    if (!isRecord(rawRule) || typeof rawRule.passed !== "boolean") continue;
    result.push({
      key,
      label: humanize(key),
      passed: rawRule.passed,
      values: summarizeRuleValues(rawRule),
    });
  }
  return result;
}

function toIntentOption(intent: IntentRecord): LiveIntentOption {
  return {
    id: intent.id,
    productName: stringValue(intent.payload.product_name, "Purchase"),
    merchantName: stringValue(intent.payload.merchant_name, intent.merchant_slug),
    amountCents: intent.amount_cents,
    currency: intent.currency,
    status: intent.status,
    createdAt: intent.created_at,
  };
}

function selectedRiskSignals(rules: unknown): Record<string, unknown> | null {
  if (!isRecord(rules)) return null;
  return isRecord(rules.risk_signals) ? rules.risk_signals : null;
}

function selectedGuardrails(rules: unknown): Record<string, unknown> | null {
  if (!isRecord(rules) || !isRecord(rules.guardrails)) return null;
  return rules.guardrails;
}

function violationsFrom(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string");
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export async function getLivePipelineData(requestedIntentId?: string | null): Promise<LivePipelineData> {
  const db = await createClient();
  const {
    data: { user },
    error: authError,
  } = await db.auth.getUser();
  if (authError || !user) throw new Error("not signed in");

  const { data: recentData, error: recentError } = await db
    .from("action_intents")
    .select("id, agent_id, status, payload, amount_cents, currency, merchant_slug, recurring, created_at, updated_at")
    .order("created_at", { ascending: false })
    .limit(10);
  if (recentError) throw new Error(`live intent lookup failed: ${recentError.message}`);

  const recent = (recentData ?? []) as IntentRecord[];
  let selected =
    requestedIntentId && isUuid(requestedIntentId)
      ? recent.find((intent) => intent.id === requestedIntentId) ?? null
      : recent[0] ?? null;

  if (!selected && requestedIntentId && isUuid(requestedIntentId)) {
    const { data, error } = await db
      .from("action_intents")
      .select("id, agent_id, status, payload, amount_cents, currency, merchant_slug, recurring, created_at, updated_at")
      .eq("id", requestedIntentId)
      .maybeSingle();
    if (error) throw new Error(`selected intent lookup failed: ${error.message}`);
    selected = (data as IntentRecord | null) ?? null;
  }

  if (!selected) {
    return {
      userId: user.id,
      selectedIntentId: null,
      intents: recent.map(toIntentOption),
      snapshot: null,
      fetchedAt: new Date().toISOString(),
    };
  }

  const [decisionResult, approvalResult, executionResult, receiptResult, agentResult, merchantResult, auditResult, verification] =
    await Promise.all([
      db
        .from("policy_decisions")
        .select("decision, rules_evaluated, violations, created_at")
        .eq("intent_id", selected.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      db
        .from("approvals")
        .select("status, intent_hash, requested_at, resolved_at")
        .eq("intent_id", selected.id)
        .maybeSingle(),
      db
        .from("executions")
        .select("status, provider, provider_operation_id, started_at, completed_at")
        .eq("intent_id", selected.id)
        .maybeSingle(),
      db
        .from("receipts")
        .select("id, provider, provider_reference, amount_cents, currency, created_at")
        .eq("intent_id", selected.id)
        .maybeSingle(),
      db.from("agents").select("name, agent_type").eq("id", selected.agent_id).maybeSingle(),
      db
        .from("merchants")
        .select("name, domain, trust_score, trust_score_source, trust_scored_at")
        .eq("slug", selected.merchant_slug)
        .maybeSingle(),
      db
        .from("audit_events")
        .select("event_hash")
        .eq("intent_id", selected.id)
        .order("created_at", { ascending: true }),
      verifyPrincipalChain(db, user.id),
    ]);

  const firstError = [
    decisionResult.error,
    approvalResult.error,
    executionResult.error,
    receiptResult.error,
    agentResult.error,
    merchantResult.error,
    auditResult.error,
  ].find((error) => error !== null);
  if (firstError) throw new Error(`live pipeline lookup failed: ${firstError.message}`);

  const decision = (decisionResult.data as DecisionRecord | null) ?? null;
  const approval = (approvalResult.data as ApprovalRecord | null) ?? null;
  const execution = (executionResult.data as ExecutionRecord | null) ?? null;
  const receipt = (receiptResult.data as ReceiptRecord | null) ?? null;
  const agent = (agentResult.data as AgentRecord | null) ?? null;
  const merchant = (merchantResult.data as MerchantRecord | null) ?? null;
  const auditEvents = (auditResult.data ?? []) as AuditRecord[];
  const guardrails = selectedGuardrails(decision?.rules_evaluated);
  const merchantTrust = guardrails && isRecord(guardrails.merchant_trust) ? guardrails.merchant_trust : null;
  const risk = selectedRiskSignals(decision?.rules_evaluated);

  const trustScore =
    numberValue(merchantTrust?.trustScore) ??
    numberValue(merchant?.trust_score);
  const merchantRisk =
    numberValue(risk?.merchantRisk) ??
    numberValue(risk?.merchant_risk) ??
    (trustScore === null ? null : Math.max(0, Math.min(1, 1 - trustScore / 100)));

  const intents = recent.some((intent) => intent.id === selected.id)
    ? recent
    : [selected, ...recent].slice(0, 10);

  return {
    userId: user.id,
    selectedIntentId: selected.id,
    intents: intents.map(toIntentOption),
    snapshot: {
      id: selected.id,
      status: selected.status,
      createdAt: selected.created_at,
      updatedAt: selected.updated_at,
      channel: normalizeChannel(selected.payload.channel),
      agent: {
        name: agent?.name ?? "Agent",
        type: agent?.agent_type ?? "agent",
      },
      intent: {
        productName: stringValue(selected.payload.product_name, "Purchase"),
        merchantName: stringValue(selected.payload.merchant_name, merchant?.name ?? selected.merchant_slug),
        merchantSlug: selected.merchant_slug,
        amountCents: selected.amount_cents,
        currency: selected.currency,
        recurring: selected.recurring,
        quantity: Math.max(1, Math.round(numberValue(selected.payload.quantity) ?? 1)),
        category: stringValue(selected.payload.category, "software"),
      },
      trust: {
        score: trustScore,
        source: stringValue(merchantTrust?.trustSource, merchant?.trust_score_source ?? "unavailable"),
        checkedAt: merchant?.trust_scored_at ?? null,
        domain: stringValue(merchantTrust?.domain, merchant?.domain ?? "") || null,
      },
      jev: {
        available: risk !== null,
        provider: risk ? stringValue(risk.provider, "jev") : null,
        model: risk ? stringValue(risk.model, "jev-latest") : null,
        cached: risk ? booleanValue(risk.cached, false) : false,
        promptInjection: numberValue(risk?.promptInjection) ?? numberValue(risk?.prompt_injection),
        cryptoExfiltration: numberValue(risk?.cryptoExfiltration) ?? numberValue(risk?.crypto_exfiltration),
        priceAnomaly: numberValue(risk?.priceAnomaly) ?? numberValue(risk?.price_anomaly),
        merchantRisk,
      },
      policy: decision
        ? {
            decision: decision.decision,
            rules: flattenRules(decision.rules_evaluated),
            violations: violationsFrom(decision.violations),
            createdAt: decision.created_at,
          }
        : null,
      approval: approval
        ? {
            status: approval.status,
            intentHash: approval.intent_hash,
            requestedAt: approval.requested_at,
            resolvedAt: approval.resolved_at,
          }
        : null,
      execution: execution
        ? {
            status: execution.status,
            provider: execution.provider,
            paymentIntentId: execution.provider_operation_id,
            startedAt: execution.started_at,
            completedAt: execution.completed_at,
          }
        : null,
      receipt: receipt
        ? {
            id: receipt.id,
            provider: receipt.provider,
            providerReference: receipt.provider_reference,
            amountCents: receipt.amount_cents,
            currency: receipt.currency,
            createdAt: receipt.created_at,
          }
        : null,
      audit: {
        eventCount: auditEvents.length,
        verified: verification.valid,
        verifiedCount: verification.verifiedCount,
        latestHash: auditEvents.at(-1)?.event_hash ?? null,
        reason: verification.reason ?? null,
      },
    },
    fetchedAt: new Date().toISOString(),
  };
}

// AgentLedger domain pipeline: propose → evaluate → (deny | approval | auto) → execute → receipt → audit.
// Runtime-agnostic (Next.js server + Supabase Edge/Deno MCP). The model is never consulted for authorization.
//
// Callers MUST establish `principalId` from Supabase Auth before constructing a DomainContext, and `db`
// must be a server-side service-role client. Nothing in here trusts identity from tool/browser payloads.
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { evaluateAction } from "../policy/evaluate.ts";
import type { AuthorizationDecision, Delegation, PurchaseIntent, ViolationCode } from "../policy/types.ts";
import { appendAuditEvent } from "./audit.ts";
import { formatUsd, getProductRow, searchProductRows, toProductView, type ProductView } from "./products.ts";
import type { PaymentProvider } from "../payments/provider.ts";
import type { GuardrailResult, GuardrailViolation } from "../policy/guardrails.ts";
import {
  assessProductRisk,
  computeIntentHash,
  getAgentStatus,
  isExternalProduct,
  productCategory,
  reconcileExternalMerchantViolations,
  runGuardrails,
  triggerKillSwitch,
  type GuardrailPolicyRow,
  type RiskSignals,
} from "./guardrail-gate.ts";

export interface DomainContext {
  db: SupabaseClient;
  principalId: string;
  agentId: string;
  payments: PaymentProvider;
  /** Where the call came from, recorded in audit events (e.g. "playground", "mcp", "dashboard"). */
  channel: string;
  /** Server-side Jev key for guardrail signals; absent ⇒ signals unavailable ⇒ human approval required. */
  jevApiKey?: string | null;
  now?: () => Date;
}

export type ExecutionViolation = "APPROVAL_HASH_MISMATCH";

export type AnyViolation = ViolationCode | GuardrailViolation | ExecutionViolation;

type Log = (message: string, fields: Record<string, unknown>) => void;
const log: Log = (message, fields) => {
  console.log(JSON.stringify({ at: new Date().toISOString(), scope: "agentledger", message, ...fields }));
};

// ---------------------------------------------------------------------------------------------
// Setup / identity

/** Idempotently provisions profile + default agent + demo delegation. Returns the agent id. */
export async function ensurePrincipalSetup(db: SupabaseClient, principalId: string, displayName: string): Promise<string> {
  const { data, error } = await db.rpc("ensure_principal_setup", {
    p_principal_id: principalId,
    p_display_name: displayName,
  });
  if (error || typeof data !== "string") throw new Error(`principal setup failed: ${error?.message ?? "no agent id"}`);
  return data;
}

interface DelegationRow {
  id: string;
  principal_id: string;
  agent_id: string;
  action_type: "purchase";
  max_amount_cents: number;
  daily_limit_cents: number;
  approval_threshold_cents: number;
  allow_recurring: boolean;
  allowed_merchants: string[];
  denied_merchants: string[];
  valid_from: string;
  valid_until: string | null;
  status: "active" | "disabled" | "revoked";
}

export function rowToDelegation(row: DelegationRow): Delegation {
  return {
    id: row.id,
    principalId: row.principal_id,
    agentId: row.agent_id,
    actionType: row.action_type,
    maxAmountCents: row.max_amount_cents,
    dailyLimitCents: row.daily_limit_cents,
    approvalThresholdCents: row.approval_threshold_cents,
    allowRecurring: row.allow_recurring,
    allowedMerchants: row.allowed_merchants ?? [],
    deniedMerchants: row.denied_merchants ?? [],
    validFrom: row.valid_from,
    validUntil: row.valid_until,
    status: row.status,
  };
}

/** Most recent purchase delegation from this principal to this agent (any status; the policy judges it). */
export async function getDelegation(ctx: Pick<DomainContext, "db" | "principalId" | "agentId">): Promise<Delegation | null> {
  const { data, error } = await ctx.db
    .from("delegations")
    .select("*")
    .eq("principal_id", ctx.principalId)
    .eq("agent_id", ctx.agentId)
    .eq("action_type", "purchase")
    .order("created_at", { ascending: false })
    .limit(1);
  if (error) throw new Error(`delegation lookup failed: ${error.message}`);
  const row = data?.[0] as DelegationRow | undefined;
  return row ? rowToDelegation(row) : null;
}

export async function listDelegations(ctx: DomainContext) {
  const delegation = await getDelegation(ctx);
  const now = (ctx.now ?? (() => new Date()))();
  const active =
    delegation &&
    delegation.status === "active" &&
    new Date(delegation.validFrom) <= now &&
    (!delegation.validUntil || new Date(delegation.validUntil) > now);
  return {
    delegations: active
      ? [
          {
            delegation_id: delegation.id,
            action: delegation.actionType,
            max_amount_cents: delegation.maxAmountCents,
            daily_limit_cents: delegation.dailyLimitCents,
            approval_threshold_cents: delegation.approvalThresholdCents,
            allow_recurring: delegation.allowRecurring,
            allowed_merchants: delegation.allowedMerchants,
            valid_until: delegation.validUntil,
          },
        ]
      : [],
  };
}

// ---------------------------------------------------------------------------------------------
// Search

export async function searchProducts(ctx: DomainContext, query: string): Promise<{ products: ProductView[] }> {
  const q = z.string().trim().max(200).parse(query);
  const rows = await searchProductRows(ctx.db, q);
  const products = rows.map(toProductView);
  await appendAuditEvent(ctx.db, {
    principalId: ctx.principalId,
    agentId: ctx.agentId,
    eventType: "PRODUCT_SEARCHED",
    eventData: { query: q, channel: ctx.channel, result_count: products.length, product_ids: products.map((p) => p.product_id) },
  });
  const suspicious = products.filter((p) => p.suspicious_content_detected || !p.merchant.trusted);
  if (suspicious.length > 0) {
    await appendAuditEvent(ctx.db, {
      principalId: ctx.principalId,
      agentId: ctx.agentId,
      eventType: "UNTRUSTED_CONTENT_ENCOUNTERED",
      eventData: {
        channel: ctx.channel,
        products: suspicious.map((p) => ({
          product_id: p.product_id,
          merchant: p.merchant.slug,
          merchant_trusted: p.merchant.trusted,
          prompt_injection_suspected: p.suspicious_content_detected,
          excerpt: p.untrusted_merchant_content.description.slice(0, 280),
        })),
      },
    });
  }
  return { products };
}

// ---------------------------------------------------------------------------------------------
// Propose

export const ProposePurchaseInput = z.object({
  product_id: z.string().uuid(),
  quantity: z.number().int().min(1).max(50).default(1),
  reason: z.string().max(1000).optional(),
  idempotency_key: z.string().min(8).max(200).optional(),
  // Anything below is agent-CLAIMED and only recorded as evidence. It never influences authorization.
  claimed_amount_cents: z.number().optional(),
  claimed_recurring: z.boolean().optional(),
  claimed_merchant: z.string().max(100).optional(),
});
export type ProposePurchaseInput = z.input<typeof ProposePurchaseInput>;

export type ExecuteResult =
  | {
      status: "executed";
      intent_id: string;
      execution_id: string;
      amount: number;
      currency: string;
      receipt_id: string;
      provider: string;
      provider_reference: string;
      stripe_payment_intent_id: string | null;
    }
  | {
      status: "duplicate";
      intent_id: string;
      already_executed: boolean;
      original_execution_id: string | null;
      original_receipt_id: string | null;
      additional_charge_cents: 0;
      message: string;
    }
  | { status: "failed"; intent_id: string; execution_id: string | null; error: { code: string; message: string } }
  | { status: "denied"; intent_id: string; violations: AnyViolation[]; reasons: string[]; message: string }
  | { status: "not_executable"; intent_id: string; current_status: string; message: string };

export type ProposeResult =
  | {
      status: "denied";
      intent_id: string;
      violations: AnyViolation[];
      reasons: string[];
      authoritative: AuthoritativeTerms;
      message: string;
      kill_switch?: { triggered: boolean; reason: string | null };
      risk?: RiskSignals | null;
    }
  | {
      status: "awaiting_approval";
      intent_id: string;
      approval_id: string;
      authoritative: AuthoritativeTerms;
      message: string;
    }
  | ({ authoritative: AuthoritativeTerms } & ExecuteResult)
  | { status: "replay"; intent_id: string; current_status: string; message: string }
  | { status: "rejected"; error: string; message: string };

export interface AuthoritativeTerms {
  product_id: string;
  product_name: string;
  merchant: string;
  merchant_name: string;
  amount_cents: number;
  amount_display: string;
  currency: string;
  recurring: boolean;
}

const FAIL_CLOSED_MESSAGE = "Action could not be evaluated safely, so AgentLedger denied execution.";

export function describeViolation(code: AnyViolation, decision?: AuthorizationDecision, guard?: GuardrailResult): string {
  const r = decision?.rules;
  const cents = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
  switch (code) {
    case "TRANSACTION_LIMIT_EXCEEDED": {
      const actual = cents(r?.transaction_limit?.actual);
      const limit = cents(r?.transaction_limit?.limit);
      const amount = actual !== null ? formatUsd(actual) : "the amount";
      return limit !== null
        ? `${amount} exceeds the ${formatUsd(limit)} per-transaction limit`
        : `${amount} exceeds the per-transaction limit`;
    }
    case "DAILY_LIMIT_EXCEEDED": {
      const spent = cents(r?.daily_limit?.spent);
      const requested = cents(r?.daily_limit?.requested);
      const limit = cents(r?.daily_limit?.limit);
      const cap = limit !== null ? `the ${formatUsd(limit)} daily limit` : "the daily limit";
      return spent !== null && requested !== null
        ? `would bring today's spend to ${formatUsd(spent + requested)}, above ${cap}`
        : `would exceed ${cap}`;
    }
    case "RECURRING_NOT_ALLOWED":
      return "recurring purchases (subscriptions) are prohibited by the delegation";
    case "MERCHANT_NOT_ALLOWED":
      return `merchant "${String(r?.merchant?.requested ?? "?")}" is not in the allowed merchant list`;
    case "NO_ACTIVE_DELEGATION":
      return "no active delegation authorizes this agent";
    case "ACTION_NOT_DELEGATED":
      return "this action type has not been delegated";
    case "INVALID_AMOUNT":
      return "the amount could not be validated";
    case "CURRENCY_NOT_ALLOWED":
      return "only USD purchases are permitted";
    case "AGENT_SUSPENDED":
      return "this agent is suspended by the AgentLedger kill switch; a human must re-enable it";
    case "MERCHANT_TRUST_TOO_LOW":
      return `merchant trust score ${String(guard?.checks?.merchant_trust?.trustScore ?? "unknown")} is below the required ${String(guard?.checks?.merchant_trust?.minTrustScore ?? 95)}`;
    case "MERCHANT_TRUST_UNKNOWN":
      return "merchant has no trust score; unscored websites are not allowed";
    case "PROMPT_INJECTION_DETECTED":
      return "merchant content was flagged as prompt injection by the Jev guardrail";
    case "CRYPTO_EXFILTRATION_DETECTED":
      return "merchant content tries to divert funds (crypto/off-platform payment)";
    case "MERCHANT_NOT_VERIFIED":
      return "merchant is not verified in the AgentLedger registry, and your delegation requires verified merchants";
    case "WEBSITE_NOT_ALLOWED":
      return `website ${String(guard?.checks?.allowed_websites?.domain ?? "?")} is not in your allowed websites list`;
    case "MERCHANT_RISK_HIGH":
      return `Jev scored this merchant ${String(guard?.checks?.merchant_risk?.score ?? "?")} likely unsafe to transact with (threshold ${String(guard?.checks?.merchant_risk?.threshold ?? 0.9)}; trust ${String(guard?.checks?.merchant_trust?.trustScore ?? "unknown")} via ${String(guard?.checks?.merchant_trust?.trustSource ?? "unavailable")})`;
    case "PRICE_ANOMALY":
      return "price is far above typical market pricing for this product (Jev price check)";
    case "CATEGORY_BLOCKED": {
      const cat = String(guard?.checks?.category_blocked?.category ?? "?");
      return `purchases in category ${cat} are blocked by your policy (e.g. crypto, gift cards, wire transfers)`;
    }
    case "CATEGORY_NOT_ALLOWED": {
      const cat = String(guard?.checks?.category_allowed?.category ?? "?");
      return `purchases in category ${cat} are not allowed by your delegation`;
    }
    case "PRICE_ABOVE_MARKET": {
      const unit = Number(guard?.checks?.market_price?.unitPriceCents ?? 0);
      const market = guard?.checks?.market_price?.marketPriceCents;
      const tolerance = Number(guard?.checks?.market_price?.tolerance ?? 1.5);
      const marketUsd = typeof market === "number" ? formatUsd(market) : "?";
      return `${formatUsd(unit)} is more than ${tolerance}× the typical market price (${marketUsd})`;
    }
    case "APPROVAL_HASH_MISMATCH":
      return "the purchase terms changed after human approval; execution was blocked";
    default:
      return String(code);
  }
}

function riskLevel(terms: AuthoritativeTerms, merchantTrusted: boolean, delegation: Delegation | null) {
  if (!merchantTrusted) return "critical";
  if (delegation && terms.amount_cents > delegation.maxAmountCents) return "high";
  if (terms.recurring) return "medium";
  return "low";
}

async function canonicalKey(parts: Record<string, unknown>): Promise<string> {
  const json = JSON.stringify(Object.keys(parts).sort().map((k) => [k, parts[k]]));
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(json));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

async function setStatus(ctx: DomainContext, intentId: string, to: string) {
  const { error } = await ctx.db.from("action_intents").update({ status: to }).eq("id", intentId).eq("principal_id", ctx.principalId);
  if (error) throw new Error(`state transition to ${to} failed: ${error.message}`);
}

async function dailySpend(ctx: DomainContext, excludeIntentId: string | null): Promise<number> {
  const { data, error } = await ctx.db.rpc("daily_committed_spend", {
    p_principal_id: ctx.principalId,
    p_exclude_intent: excludeIntentId,
  });
  if (error) throw new Error(`daily spend lookup failed: ${error.message}`);
  const n = Number(data);
  if (!Number.isFinite(n)) throw new Error("daily spend not numeric");
  return n;
}

export async function proposePurchase(ctx: DomainContext, rawInput: unknown): Promise<ProposeResult> {
  const parsed = ProposePurchaseInput.safeParse(rawInput);
  if (!parsed.success) {
    return { status: "rejected", error: "INVALID_INPUT", message: `Invalid purchase proposal: ${parsed.error.issues.map((i) => i.message).join("; ")}` };
  }
  const input = parsed.data;

  // 1. Authoritative product terms come from the database, never from the agent.
  const product = await getProductRow(ctx.db, input.product_id);
  if (!product || !product.active) {
    return { status: "rejected", error: "PRODUCT_NOT_FOUND", message: "Unknown or inactive product. No action was created." };
  }
  const category = productCategory(product);
  const external = isExternalProduct(product);
  const terms: AuthoritativeTerms = {
    product_id: product.id,
    product_name: product.name,
    merchant: product.merchants.slug,
    merchant_name: product.merchants.name,
    amount_cents: product.price_cents * input.quantity,
    amount_display: formatUsd(product.price_cents * input.quantity),
    currency: product.currency,
    recurring: product.recurring,
  };

  const claimed = {
    amount_cents: input.claimed_amount_cents,
    recurring: input.claimed_recurring,
    merchant: input.claimed_merchant,
  };
  const tampering: string[] = [];
  if (claimed.amount_cents !== undefined && claimed.amount_cents !== terms.amount_cents) tampering.push("amount_cents");
  if (claimed.recurring !== undefined && claimed.recurring !== terms.recurring) tampering.push("recurring");
  if (claimed.merchant !== undefined && claimed.merchant !== terms.merchant) tampering.push("merchant");

  let delegation: Delegation | null = null;
  try {
    delegation = await getDelegation(ctx);
  } catch (error) {
    log("delegation lookup failed; failing closed", { error: String(error) });
    delegation = null;
  }

  const intentPayload: PurchaseIntent = {
    actionType: "purchase",
    merchantSlug: terms.merchant,
    productId: terms.product_id,
    amountCents: terms.amount_cents,
    currency: terms.currency,
    recurring: terms.recurring,
  };

  const idempotencyKey =
    input.idempotency_key ??
    (await canonicalKey({
      principalId: ctx.principalId,
      agentId: ctx.agentId,
      ...intentPayload,
      nonce: crypto.randomUUID(),
    }));

  // 2. Record the intent. unique(principal_id, idempotency_key) makes a replayed proposal a no-op.
  const { data: inserted, error: insertError } = await ctx.db
    .from("action_intents")
    .insert({
      principal_id: ctx.principalId,
      agent_id: ctx.agentId,
      delegation_id: delegation?.id ?? null,
      action_type: "purchase",
      status: "proposed",
      payload: {
        ...intentPayload,
        quantity: input.quantity,
        category,
        product_name: terms.product_name,
        merchant_name: terms.merchant_name,
        merchant_trusted: product.merchants.trusted,
        channel: ctx.channel,
        agent_claimed: claimed,
        tampered_fields: tampering,
        // External (unverified website) purchases: the price is agent-claimed, never verified.
        ...(external
          ? { external: true, claimed_price_cents: product.price_cents, source_url: product.external_url ?? null }
          : {}),
      },
      amount_cents: terms.amount_cents,
      currency: terms.currency,
      merchant_slug: terms.merchant,
      product_id: terms.product_id,
      recurring: terms.recurring,
      idempotency_key: idempotencyKey,
      risk_level: riskLevel(terms, product.merchants.trusted, delegation),
      reason: input.reason ?? null,
    })
    .select("id")
    .single();

  if (insertError) {
    if (insertError.code === "23505") {
      const { data: existing } = await ctx.db
        .from("action_intents")
        .select("id, status")
        .eq("principal_id", ctx.principalId)
        .eq("idempotency_key", idempotencyKey)
        .maybeSingle();
      await appendAuditEvent(ctx.db, {
        principalId: ctx.principalId,
        agentId: ctx.agentId,
        intentId: existing?.id ?? null,
        eventType: "REPLAY_ATTEMPT_BLOCKED",
        eventData: { channel: ctx.channel, idempotency_key: idempotencyKey, current_status: existing?.status ?? "unknown" },
      });
      return {
        status: "replay",
        intent_id: existing?.id ?? "",
        current_status: existing?.status ?? "unknown",
        message: "This exact action was already proposed. AgentLedger returned the original instead of creating a new one.",
      };
    }
    throw new Error(`intent insert failed: ${insertError.message}`);
  }
  const intentId = (inserted as { id: string }).id;
  log("intent proposed", { intent_id: intentId, amount_cents: terms.amount_cents, merchant: terms.merchant });

  await appendAuditEvent(ctx.db, {
    principalId: ctx.principalId,
    agentId: ctx.agentId,
    intentId,
    eventType: "INTENT_PROPOSED",
    eventData: {
      channel: ctx.channel,
      action: "purchase",
      ...terms,
      merchant_trusted: product.merchants.trusted,
      reason: input.reason ?? null,
      agent_claimed: claimed,
    },
  });
  if (tampering.length > 0) {
    await appendAuditEvent(ctx.db, {
      principalId: ctx.principalId,
      agentId: ctx.agentId,
      intentId,
      eventType: "PARAMETER_TAMPERING_DETECTED",
      eventData: {
        fields: tampering,
        agent_claimed: claimed,
        authoritative: { amount_cents: terms.amount_cents, recurring: terms.recurring, merchant: terms.merchant },
        note: "Agent-supplied values were ignored; authoritative database values were used.",
      },
    });
  }

  // 3. Deterministic policy evaluation (delegation rules + guardrail rules over external signals).
  //    Any failure here denies. Deny always wins.
  let decision: AuthorizationDecision;
  let guard: GuardrailResult;
  let risk: RiskSignals | null = null;
  let guardPolicy: GuardrailPolicyRow | null = null;
  try {
    await setStatus(ctx, intentId, "evaluating");
    await appendAuditEvent(ctx.db, {
      principalId: ctx.principalId,
      agentId: ctx.agentId,
      intentId,
      eventType: "POLICY_EVALUATION_STARTED",
      eventData: { delegation_id: delegation?.id ?? null },
    });
    const spent = await dailySpend(ctx, intentId);
    decision = evaluateAction({ delegation, intent: intentPayload, dailySpendCents: spent, now: (ctx.now ?? (() => new Date()))() });
    if (delegation) {
      const { data } = await ctx.db.from("delegations").select("*").eq("id", delegation.id).maybeSingle();
      guardPolicy = (data as GuardrailPolicyRow | null) ?? null;
    }
    const agentStatus = await getAgentStatus(ctx.db, ctx.agentId);
    risk = await assessProductRisk(ctx.db, ctx.principalId, product, ctx.jevApiKey, intentId);
    guard = runGuardrails(agentStatus, product, guardPolicy, risk, { quantity: input.quantity });
  } catch (error) {
    log("policy evaluation failed; failing closed", { intent_id: intentId, error: String(error) });
    await ctx.db.from("action_intents").update({ status: "denied" }).eq("id", intentId);
    await appendAuditEvent(ctx.db, {
      principalId: ctx.principalId,
      agentId: ctx.agentId,
      intentId,
      eventType: "EVALUATION_FAILED_CLOSED",
      eventData: { message: FAIL_CLOSED_MESSAGE },
    });
    return { status: "denied", intent_id: intentId, violations: [], reasons: [FAIL_CLOSED_MESSAGE], authoritative: terms, message: FAIL_CLOSED_MESSAGE };
  }

  // Merge step: an external domain the human listed in allowed_domains/trusted_domain_overrides
  // clears the base MERCHANT_NOT_ALLOWED rule (external merchants are never in allowed_merchants).
  const baseViolations = reconcileExternalMerchantViolations(product, guardPolicy, decision.violations);
  const allViolations: AnyViolation[] = [...baseViolations, ...guard.violations];
  const finalDecision: "deny" | "require_approval" | "auto_approve" =
    allViolations.length > 0 ? "deny" : decision.decision === "require_approval" || guard.requireApproval ? "require_approval" : "auto_approve";
  const rulesEvaluated = { ...decision.rules, guardrails: guard.checks, risk_signals: risk };

  await appendAuditEvent(ctx.db, {
    principalId: ctx.principalId,
    agentId: ctx.agentId,
    intentId,
    eventType: "GUARDRAILS_EVALUATED",
    eventData: {
      checks: guard.checks,
      violations: guard.violations,
      require_approval: guard.requireApproval,
      risk_signals: risk,
      signal_source: risk ? `${risk.provider} ${risk.model}` : "unavailable (fails toward human approval)",
    },
  });

  await ctx.db.from("policy_decisions").insert({
    intent_id: intentId,
    principal_id: ctx.principalId,
    decision: finalDecision,
    rules_evaluated: rulesEvaluated,
    violations: allViolations,
    approval_required: finalDecision === "require_approval",
    policy_version: `${decision.policyVersion}+guardrails-v1`,
  });

  if (finalDecision === "deny") {
    await setStatus(ctx, intentId, "denied");
    const reasons = allViolations.map((v) => describeViolation(v, decision, guard));
    await appendAuditEvent(ctx.db, {
      principalId: ctx.principalId,
      agentId: ctx.agentId,
      intentId,
      eventType: "POLICY_DENIED",
      eventData: {
        requested_amount_cents: terms.amount_cents,
        transaction_limit_cents: delegation?.maxAmountCents ?? null,
        merchant: terms.merchant,
        recurring: terms.recurring,
        violations: allViolations,
        reasons,
        rules: rulesEvaluated,
      },
    });
    log("policy denied", { intent_id: intentId, violations: allViolations });
    let killSwitch = { triggered: false, reason: null as string | null };
    if (guard.killSwitch.trigger) {
      await triggerKillSwitch(ctx.db, ctx.principalId, ctx.agentId, intentId, guard.killSwitch.reason ?? "guardrail kill switch");
      killSwitch = { triggered: true, reason: guard.killSwitch.reason };
    }
    return {
      status: "denied",
      intent_id: intentId,
      violations: allViolations,
      reasons,
      authoritative: terms,
      risk,
      kill_switch: killSwitch,
      message: killSwitch.triggered
        ? `AgentLedger DENIED this purchase and HALTED this agent (kill switch): ${reasons.join("; ")}. Stop now; a human must review.`
        : `AgentLedger DENIED this purchase: ${reasons.join("; ")}. Do not retry it; choose an allowed alternative.`,
    };
  }

  if (finalDecision === "require_approval") {
    await setStatus(ctx, intentId, "awaiting_approval");
    await appendAuditEvent(ctx.db, {
      principalId: ctx.principalId,
      agentId: ctx.agentId,
      intentId,
      eventType: "POLICY_REQUIRES_APPROVAL",
      eventData: {
        rules: rulesEvaluated,
        threshold_cents: delegation?.approvalThresholdCents ?? null,
        amount_cents: terms.amount_cents,
        escalated_by_guardrails: guard.requireApproval,
      },
    });
    const intentHash = await computeIntentHash({
      principalId: ctx.principalId,
      agentId: ctx.agentId,
      productId: terms.product_id,
      merchant: terms.merchant,
      amountCents: terms.amount_cents,
      currency: terms.currency,
      recurring: terms.recurring,
      quantity: input.quantity,
      category,
    });
    const { data: approval, error: approvalError } = await ctx.db
      .from("approvals")
      .insert({ intent_id: intentId, principal_id: ctx.principalId, status: "pending", intent_hash: intentHash })
      .select("id")
      .single();
    if (approvalError || !approval) throw new Error(`approval request failed: ${approvalError?.message}`);
    await appendAuditEvent(ctx.db, {
      principalId: ctx.principalId,
      agentId: ctx.agentId,
      intentId,
      eventType: "HUMAN_APPROVAL_REQUESTED",
      eventData: {
        approval_id: approval.id,
        amount_cents: terms.amount_cents,
        product: terms.product_name,
        merchant: terms.merchant_name,
        intent_hash: intentHash,
        quantity: input.quantity,
        category,
      },
    });
    return {
      status: "awaiting_approval",
      intent_id: intentId,
      approval_id: approval.id,
      authoritative: terms,
      message: `Policy passed, but ${terms.amount_display} is above the approval threshold. A human must approve this purchase in the AgentLedger dashboard. Wait for approval; do not re-submit.`,
    };
  }

  // auto_approve (all hard constraints passed, amount within threshold, guardrail signals clean)
  await setStatus(ctx, intentId, "approved");
  await appendAuditEvent(ctx.db, {
    principalId: ctx.principalId,
    agentId: ctx.agentId,
    intentId,
    eventType: "POLICY_AUTO_APPROVED",
    eventData: { rules: decision.rules, amount_cents: terms.amount_cents },
  });
  const executed = await executeAction(ctx, intentId);
  return { ...executed, authoritative: terms };
}

// ---------------------------------------------------------------------------------------------
// Approvals

export async function resolveApproval(
  ctx: DomainContext,
  approvalId: string,
  decisionInput: "approved" | "denied",
  reason?: string,
): Promise<{ resolved: boolean; approval_status: string; intent_id: string; intent_status: string; execution?: ExecuteResult }> {
  z.string().uuid().parse(approvalId);
  const decision = z.enum(["approved", "denied"]).parse(decisionInput);
  const { data, error } = await ctx.db.rpc("resolve_approval", {
    p_approval_id: approvalId,
    p_principal_id: ctx.principalId,
    p_decision: decision,
    p_reason: reason ?? null,
  });
  if (error) {
    if (/NOT_AUTHORIZED/.test(error.message)) throw new NotAuthorizedError("You are not the principal for this action.");
    throw new Error(`approval resolution failed: ${error.message}`);
  }
  const row = (Array.isArray(data) ? data[0] : data) as
    | { resolved: boolean; approval_status: string; intent_id: string; intent_status: string }
    | undefined;
  if (!row) throw new NotAuthorizedError("Approval not found.");

  if (row.resolved) {
    const { data: approvalRow } = await ctx.db.from("approvals").select("intent_hash").eq("id", approvalId).maybeSingle();
    const intentHash =
      approvalRow && typeof (approvalRow as { intent_hash?: string }).intent_hash === "string"
        ? (approvalRow as { intent_hash: string }).intent_hash
        : null;
    await appendAuditEvent(ctx.db, {
      principalId: ctx.principalId,
      agentId: ctx.agentId,
      intentId: row.intent_id,
      eventType: decision === "approved" ? "HUMAN_APPROVED" : "HUMAN_DENIED",
      eventData: { approval_id: approvalId, channel: ctx.channel, reason: reason ?? null, intent_hash: intentHash },
    });
  }
  if (row.resolved && decision === "approved") {
    const execution = await executeAction(ctx, row.intent_id);
    return { ...row, execution };
  }
  return row;
}

export class NotAuthorizedError extends Error {
  readonly code = "NOT_AUTHORIZED";
}

// ---------------------------------------------------------------------------------------------
// Execution

interface IntentRow {
  id: string;
  principal_id: string;
  agent_id: string;
  status: string;
  amount_cents: number;
  currency: string;
  merchant_slug: string;
  product_id: string | null;
  recurring: boolean;
  idempotency_key: string;
  payload: Record<string, unknown>;
}

async function loadIntent(ctx: DomainContext, intentId: string): Promise<IntentRow | null> {
  const { data, error } = await ctx.db
    .from("action_intents")
    .select("id, principal_id, agent_id, status, amount_cents, currency, merchant_slug, product_id, recurring, idempotency_key, payload")
    .eq("id", intentId)
    .eq("principal_id", ctx.principalId)
    .maybeSingle();
  if (error) throw new Error(`intent lookup failed: ${error.message}`);
  return (data as IntentRow | null) ?? null;
}

async function originalExecution(ctx: DomainContext, intentId: string) {
  const { data: exec } = await ctx.db.from("executions").select("id, status").eq("intent_id", intentId).maybeSingle();
  const { data: receipt } = await ctx.db.from("receipts").select("id").eq("intent_id", intentId).maybeSingle();
  return { executionId: (exec?.id as string | undefined) ?? null, receiptId: (receipt?.id as string | undefined) ?? null };
}

async function duplicateResult(ctx: DomainContext, intent: IntentRow, reason: string): Promise<ExecuteResult> {
  const original = await originalExecution(ctx, intent.id);
  await appendAuditEvent(ctx.db, {
    principalId: ctx.principalId,
    agentId: intent.agent_id,
    intentId: intent.id,
    eventType: "DUPLICATE_EXECUTION_BLOCKED",
    eventData: {
      channel: ctx.channel,
      reason,
      intent_status: intent.status,
      original_execution_id: original.executionId,
      original_receipt_id: original.receiptId,
      additional_charge_cents: 0,
    },
  });
  log("duplicate execution blocked", { intent_id: intent.id, execution_id: original.executionId });
  return {
    status: "duplicate",
    intent_id: intent.id,
    already_executed: intent.status === "executed",
    original_execution_id: original.executionId,
    original_receipt_id: original.receiptId,
    additional_charge_cents: 0,
    message: "DUPLICATE / REPLAY PREVENTED. Original transaction already committed. No additional charge.",
  };
}

/**
 * Executes an approved intent at most once. Safe to call repeatedly and concurrently:
 * `claim_execution` atomically moves approved→executing and inserts the unique execution row;
 * every other caller gets a duplicate result. The same idempotency key is sent to the provider.
 */
export async function executeAction(ctx: DomainContext, intentId: string): Promise<ExecuteResult> {
  z.string().uuid().parse(intentId);
  const intent = await loadIntent(ctx, intentId);
  if (!intent) {
    return { status: "not_executable", intent_id: intentId, current_status: "unknown", message: "Action not found for this principal." };
  }
  if (intent.status === "executed" || intent.status === "executing") {
    return duplicateResult(ctx, intent, intent.status === "executed" ? "already_executed" : "execution_in_progress");
  }
  if (intent.status !== "approved") {
    await appendAuditEvent(ctx.db, {
      principalId: ctx.principalId,
      agentId: intent.agent_id,
      intentId,
      eventType: "REPLAY_ATTEMPT_BLOCKED",
      eventData: { channel: ctx.channel, reason: "not_approved", intent_status: intent.status },
    });
    return {
      status: "not_executable",
      intent_id: intentId,
      current_status: intent.status,
      message: `Action is ${intent.status}; only approved actions can execute.`,
    };
  }

  // Re-check hard constraints at execution time (delegation may have been revoked since approval).
  let decision: AuthorizationDecision;
  try {
    if ((await getAgentStatus(ctx.db, intent.agent_id)) !== "active") throw new Error("agent not active (kill switch or disabled)");
    const delegation = await getDelegation({ db: ctx.db, principalId: ctx.principalId, agentId: intent.agent_id });
    const spent = await dailySpend(ctx, intentId);
    decision = evaluateAction({
      delegation,
      intent: {
        actionType: "purchase",
        merchantSlug: intent.merchant_slug,
        productId: intent.product_id ?? "",
        amountCents: intent.amount_cents,
        currency: intent.currency,
        recurring: intent.recurring,
      },
      dailySpendCents: spent,
      now: (ctx.now ?? (() => new Date()))(),
    });
  } catch (error) {
    log("pre-execution re-evaluation failed; failing closed", { intent_id: intentId, error: String(error) });
    decision = { decision: "deny", violations: [], approvalRequired: false, rules: {} as AuthorizationDecision["rules"], policyVersion: "fail-closed" };
  }
  if (decision.decision === "deny") {
    await setStatus(ctx, intentId, "denied");
    const reasons = decision.violations.length ? decision.violations.map((v) => describeViolation(v, decision)) : [FAIL_CLOSED_MESSAGE];
    await appendAuditEvent(ctx.db, {
      principalId: ctx.principalId,
      agentId: intent.agent_id,
      intentId,
      eventType: "POLICY_DENIED",
      eventData: { stage: "pre_execution", violations: decision.violations, reasons },
    });
    return { status: "denied", intent_id: intentId, violations: decision.violations, reasons, message: reasons.join("; ") };
  }

  const { data: approvalForHash } = await ctx.db.from("approvals").select("intent_hash").eq("intent_id", intentId).maybeSingle();
  const storedIntentHash = (approvalForHash as { intent_hash?: string | null } | null)?.intent_hash;
  if (typeof storedIntentHash === "string" && storedIntentHash.length > 0) {
    const payload = intent.payload;
    const quantity = typeof payload.quantity === "number" ? payload.quantity : 1;
    const category = typeof payload.category === "string" ? payload.category : "software";
    const currentHash = await computeIntentHash({
      principalId: intent.principal_id,
      agentId: intent.agent_id,
      productId: intent.product_id ?? "",
      merchant: intent.merchant_slug,
      amountCents: intent.amount_cents,
      currency: intent.currency,
      recurring: intent.recurring,
      quantity,
      category,
    });
    if (currentHash !== storedIntentHash) {
      await setStatus(ctx, intentId, "denied");
      const violations: ExecutionViolation[] = ["APPROVAL_HASH_MISMATCH"];
      const reasons = violations.map((v) => describeViolation(v));
      await appendAuditEvent(ctx.db, {
        principalId: ctx.principalId,
        agentId: intent.agent_id,
        intentId,
        eventType: "APPROVAL_HASH_MISMATCH",
        eventData: {
          stage: "pre_execution",
          stored_intent_hash: storedIntentHash,
          current_intent_hash: currentHash,
          amount_cents: intent.amount_cents,
          quantity,
          category,
        },
      });
      return { status: "denied", intent_id: intentId, violations, reasons, message: reasons.join("; ") };
    }
  }

  const executionKey = `agentledger_exec_${intent.id}`;
  const { data: claimData, error: claimError } = await ctx.db.rpc("claim_execution", {
    p_intent_id: intent.id,
    p_idempotency_key: executionKey,
    p_provider: ctx.payments.name,
  });
  if (claimError) throw new Error(`execution claim failed: ${claimError.message}`);
  const claim = (Array.isArray(claimData) ? claimData[0] : claimData) as
    | { claimed: boolean; execution_id: string | null; execution_status: string | null; intent_status: string }
    | undefined;
  if (!claim?.claimed || !claim.execution_id) {
    const fresh = (await loadIntent(ctx, intentId)) ?? intent;
    return duplicateResult(ctx, fresh, "concurrent_claim_lost");
  }
  const executionId = claim.execution_id;

  await appendAuditEvent(ctx.db, {
    principalId: ctx.principalId,
    agentId: intent.agent_id,
    intentId,
    eventType: "EXECUTION_STARTED",
    eventData: { execution_id: executionId, provider: ctx.payments.name, provider_label: ctx.payments.label, idempotency_key: executionKey },
  });
  log("execution started", { intent_id: intentId, execution_id: executionId, provider: ctx.payments.name });

  const payment = await ctx.payments.executePurchase({
    idempotencyKey: executionKey,
    amountCents: intent.amount_cents,
    currency: intent.currency,
    description: `AgentLedger: ${String(intent.payload.product_name ?? "purchase")} (${intent.merchant_slug})`,
    metadata: {
      agentledger_intent_id: intent.id,
      agentledger_execution_id: executionId,
      principal_id: intent.principal_id,
      agent_id: intent.agent_id,
      merchant: intent.merchant_slug,
    },
  });

  if (!payment.ok) {
    await ctx.db
      .from("executions")
      .update({ status: "failed", error: payment.error, completed_at: new Date().toISOString() })
      .eq("id", executionId);
    await setStatus(ctx, intentId, "failed");
    await appendAuditEvent(ctx.db, {
      principalId: ctx.principalId,
      agentId: intent.agent_id,
      intentId,
      eventType: "PAYMENT_FAILED",
      eventData: { execution_id: executionId, provider: payment.provider, error: payment.error },
    });
    log("payment failed", { intent_id: intentId, execution_id: executionId, code: payment.error.code });
    return { status: "failed", intent_id: intentId, execution_id: executionId, error: payment.error };
  }

  await ctx.db
    .from("executions")
    .update({
      status: "succeeded",
      provider_operation_id: payment.providerReference,
      result: payment.raw,
      completed_at: new Date().toISOString(),
    })
    .eq("id", executionId);
  await appendAuditEvent(ctx.db, {
    principalId: ctx.principalId,
    agentId: intent.agent_id,
    intentId,
    eventType: "PAYMENT_SUCCEEDED",
    eventData: {
      execution_id: executionId,
      provider: payment.provider,
      provider_reference: payment.providerReference,
      amount_cents: intent.amount_cents,
      currency: intent.currency,
      livemode: false,
    },
  });

  const { data: receipt, error: receiptError } = await ctx.db
    .from("receipts")
    .insert({
      intent_id: intentId,
      execution_id: executionId,
      principal_id: ctx.principalId,
      provider: payment.provider,
      provider_reference: payment.providerReference,
      amount_cents: intent.amount_cents,
      currency: intent.currency,
      receipt_data: {
        product_name: intent.payload.product_name ?? null,
        merchant: intent.merchant_slug,
        merchant_name: intent.payload.merchant_name ?? null,
        recurring: intent.recurring,
        provider_label: ctx.payments.label,
        payment: payment.raw,
      },
    })
    .select("id")
    .single();
  if (receiptError || !receipt) throw new Error(`receipt insert failed: ${receiptError?.message}`);
  await setStatus(ctx, intentId, "executed");
  await appendAuditEvent(ctx.db, {
    principalId: ctx.principalId,
    agentId: intent.agent_id,
    intentId,
    eventType: "RECEIPT_CREATED",
    eventData: { receipt_id: receipt.id, execution_id: executionId, provider_reference: payment.providerReference, amount_cents: intent.amount_cents },
  });
  log("executed", { intent_id: intentId, execution_id: executionId, receipt_id: receipt.id });

  return {
    status: "executed",
    intent_id: intentId,
    execution_id: executionId,
    amount: intent.amount_cents,
    currency: intent.currency,
    receipt_id: receipt.id,
    provider: payment.provider,
    provider_reference: payment.providerReference,
    stripe_payment_intent_id: payment.provider === "stripe" ? payment.providerReference : null,
  };
}

// ---------------------------------------------------------------------------------------------
// Status / receipts

export async function getActionStatus(ctx: DomainContext, intentId: string) {
  z.string().uuid().parse(intentId);
  const intent = await loadIntent(ctx, intentId);
  if (!intent) return { status: "not_found" as const, intent_id: intentId };
  const [{ data: decision }, { data: approval }, { data: receipt }] = await Promise.all([
    ctx.db.from("policy_decisions").select("decision, violations, created_at").eq("intent_id", intentId).order("created_at", { ascending: false }).limit(1).maybeSingle(),
    ctx.db.from("approvals").select("id, status, resolved_at").eq("intent_id", intentId).maybeSingle(),
    ctx.db.from("receipts").select("id, provider, provider_reference, amount_cents, currency, created_at").eq("intent_id", intentId).maybeSingle(),
  ]);
  return {
    status: intent.status,
    intent_id: intentId,
    amount_cents: intent.amount_cents,
    currency: intent.currency,
    merchant: intent.merchant_slug,
    recurring: intent.recurring,
    policy_decision: decision ?? null,
    approval: approval ?? null,
    receipt: receipt ?? null,
  };
}

export async function getReceipt(ctx: DomainContext, ref: { receipt_id?: string; intent_id?: string }) {
  let query = ctx.db.from("receipts").select("*").eq("principal_id", ctx.principalId);
  if (ref.receipt_id) query = query.eq("id", z.string().uuid().parse(ref.receipt_id));
  else if (ref.intent_id) query = query.eq("intent_id", z.string().uuid().parse(ref.intent_id));
  else return { receipt: null };
  const { data, error } = await query.maybeSingle();
  if (error) throw new Error(`receipt lookup failed: ${error.message}`);
  return { receipt: data ?? null };
}

// ---------------------------------------------------------------------------------------------
// Demo reset (callers must gate on demo mode)

export async function resetDemo(ctx: DomainContext) {
  const { error } = await ctx.db.rpc("reset_demo", { p_principal_id: ctx.principalId });
  if (error) throw new Error(`demo reset failed: ${error.message}`);
  await appendAuditEvent(ctx.db, {
    principalId: ctx.principalId,
    agentId: ctx.agentId,
    eventType: "DEMO_RESET",
    eventData: { channel: ctx.channel },
  });
}

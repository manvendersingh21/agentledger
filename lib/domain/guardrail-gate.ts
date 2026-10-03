// Guardrail gate: external signals (Jev, merchant trust score) in → deterministic guardrail rules out.
// Runtime-agnostic. A missing/failed signal never auto-approves (see lib/policy/guardrails.ts).
import type { SupabaseClient } from "@supabase/supabase-js";
import { canonicalJson, sha256Hex } from "../crypto/audit-chain.ts";
import { evaluateGuardrails, externalDomainAllowed, type GuardrailResult } from "../policy/guardrails.ts";
import type { ViolationCode } from "../policy/types.ts";
import { assessListing, contentHash, type AssessListingInput, type JevAssessment } from "../risk/jev.ts";
import type { TrustScore } from "../risk/scamadvisor.ts";
import { refreshMerchantTrust } from "../risk/trust-refresh.ts";
import { appendAuditEvent } from "./audit.ts";
import type { ProductRow } from "./products.ts";

/** Scenario catalog fields (migration `20261003050000_scenarios.sql`); optional until column exists. */
export type ScenarioProductRow = ProductRow & {
  category?: string;
  market_price_cents?: number | null;
  /** Merchant network (migration `20261003060000_merchant_network.sql`): 'catalog' | 'merchant_feed' | 'external'. */
  source?: string | null;
  external_url?: string | null;
};

/**
 * External (unverified website) purchase detection. Primary signal is `products.source = 'external'`.
 * When the caller's SELECT does not include `source`, we fail toward "external": a product whose
 * merchant is neither trusted, nor registry-verified, nor a seeded demo fixture can only have come
 * from the external purchase flow — and unverified purchases must always go to the human anyway.
 */
export function isExternalProduct(product: ProductRow): boolean {
  const row = product as ScenarioProductRow;
  if (typeof row.source === "string" && row.source.length > 0) {
    return row.source === "external";
  }
  const merchant = product.merchants;
  return (
    merchant.trusted !== true &&
    merchant.verified !== true &&
    (merchant.trust_score_source ?? "unavailable") !== "fixture"
  );
}

/**
 * Merchant allowlist rule for externals: an external domain passes the base MERCHANT_NOT_ALLOWED
 * rule only when the human listed it in allowed_domains or trusted_domain_overrides. The pipeline
 * must pass the merged base-policy violations through this before deciding deny vs approval.
 * Deterministic; never removes any other violation.
 */
export function reconcileExternalMerchantViolations(
  product: ProductRow,
  policy: GuardrailPolicyRow | null,
  baseViolations: ViolationCode[],
): ViolationCode[] {
  if (!isExternalProduct(product)) return baseViolations;
  const allowed = externalDomainAllowed(product.merchants.domain ?? null, {
    allowedDomains: policy?.allowed_domains ?? [],
    trustedDomainOverrides: policy?.trusted_domain_overrides ?? [],
  });
  if (!allowed) return baseViolations;
  return baseViolations.filter((v) => v !== "MERCHANT_NOT_ALLOWED");
}

export interface IntentHashInput {
  principalId: string;
  agentId: string;
  productId: string;
  merchant: string;
  amountCents: number;
  currency: string;
  recurring: boolean;
  quantity: number;
  category: string;
}

/** sha256 hex of canonical intent terms at approval-request time (hash-bound human approval). */
export async function computeIntentHash(input: IntentHashInput): Promise<string> {
  const payload = canonicalJson({
    principalId: input.principalId,
    agentId: input.agentId,
    productId: input.productId,
    merchant: input.merchant,
    amountCents: input.amountCents,
    currency: input.currency,
    recurring: input.recurring,
    quantity: input.quantity,
    category: input.category,
  });
  return sha256Hex(payload);
}

export interface RiskSignals {
  promptInjection: number;
  cryptoExfiltration: number;
  priceAnomaly: number;
  /** Jev merchantRisk: P(merchant unsafe to transact with). Null when a cached row predates the question. */
  merchantRisk: number | null;
  /** Merchant trust at assessment time (input to Jev): live ScamAdviser refresh or labelled fixture. */
  merchantTrustScore: number | null;
  merchantTrustSource: string;
  merchantTrustCheckedAt: string | null;
  merchantVerified: boolean;
  provider: string;
  model: string;
  cached: boolean;
}

/**
 * Fresh merchant trust for the risk chain: live ScamAdviser page check for real domains (24h cache);
 * fixture merchants keep their labelled fixture score. Falls back to the stored merchant row on any
 * refresh failure — the deterministic trust rule still fails closed on a null score.
 */
async function resolveMerchantTrust(db: SupabaseClient, product: ProductRow): Promise<TrustScore> {
  try {
    return await refreshMerchantTrust(db, { merchantId: product.merchant_id });
  } catch {
    const merchant = product.merchants;
    const stored = merchant.trust_score === null || merchant.trust_score === undefined ? null : Number(merchant.trust_score);
    const source = merchant.trust_score_source;
    return {
      domain: merchant.domain?.trim().toLowerCase() ?? "",
      score: stored !== null && Number.isFinite(stored) ? stored : null,
      source: source === "scamadvisor" || source === "fixture" ? source : "unavailable",
      checkedAt: new Date().toISOString(),
    };
  }
}

function listingInput(product: ProductRow, trust: TrustScore): AssessListingInput {
  const rpm = product.metadata?.requests_per_month;
  return {
    productName: product.name,
    merchantName: product.merchants.name,
    merchantDomain: product.merchants.domain ?? null,
    description: product.description,
    metadata: product.metadata,
    priceCents: product.price_cents,
    currency: product.currency,
    recurring: product.recurring,
    requestsPerMonth: typeof rpm === "number" ? rpm : null,
    merchantTrustScore: trust.score,
    merchantTrustSource: trust.source,
    merchantVerified: product.merchants.verified === true,
  };
}

/** merchant_* chain fields persisted in risk_assessments.raw (no schema change needed). */
function chainRawFields(trust: TrustScore, verified: boolean, merchantRisk: number | null): Record<string, unknown> {
  return {
    merchant_risk: merchantRisk,
    merchant_trust_score: trust.score,
    merchant_trust_source: trust.source,
    merchant_trust_checked_at: trust.checkedAt,
    merchant_verified: verified,
  };
}

/**
 * Jev assessment for a listing, cached per (product, content hash). Returns null when unavailable.
 * The merchant trust score is refreshed first (live ScamAdviser for real domains, 24h cache; fixture
 * merchants keep their labelled score) and fed INTO Jev — the hash covers it, so a changed trust
 * score re-assesses.
 */
export async function assessProductRisk(
  db: SupabaseClient,
  principalId: string,
  product: ProductRow,
  jevApiKey: string | null | undefined,
  intentId: string | null,
): Promise<RiskSignals | null> {
  const trust = await resolveMerchantTrust(db, product);
  const verified = product.merchants.verified === true;
  const input = listingInput(product, trust);
  let hash: string;
  try {
    hash = await contentHash(input);
  } catch {
    return null;
  }
  const { data: cached } = await db
    .from("risk_assessments")
    .select("prompt_injection, crypto_exfiltration, price_anomaly, provider, model, raw")
    .eq("product_id", product.id)
    .eq("content_hash", hash)
    .order("created_at", { ascending: false })
    .limit(1);
  const hit = cached?.[0] as
    | { prompt_injection: number; crypto_exfiltration: number; price_anomaly: number; provider: string; model: string; raw: unknown }
    | undefined;

  if (hit) {
    const hitRaw = typeof hit.raw === "object" && hit.raw !== null ? (hit.raw as Record<string, unknown>) : {};
    const cachedMerchantRisk = typeof hitRaw.merchant_risk === "number" ? hitRaw.merchant_risk : null;
    if (intentId) {
      await db.from("risk_assessments").insert({
        principal_id: principalId,
        intent_id: intentId,
        product_id: product.id,
        provider: hit.provider,
        model: hit.model,
        prompt_injection: hit.prompt_injection,
        crypto_exfiltration: hit.crypto_exfiltration,
        price_anomaly: hit.price_anomaly,
        content_hash: hash,
        raw: { cached: true, ...chainRawFields(trust, verified, cachedMerchantRisk) },
      });
    }
    return {
      promptInjection: Number(hit.prompt_injection),
      cryptoExfiltration: Number(hit.crypto_exfiltration),
      priceAnomaly: Number(hit.price_anomaly),
      merchantRisk: cachedMerchantRisk,
      merchantTrustScore: trust.score,
      merchantTrustSource: trust.source,
      merchantTrustCheckedAt: trust.checkedAt,
      merchantVerified: verified,
      provider: hit.provider,
      model: hit.model,
      cached: true,
    };
  }
  if (!jevApiKey) return null;

  let assessment: JevAssessment;
  try {
    assessment = await assessListing(input, { apiKey: jevApiKey });
  } catch (error) {
    console.error(JSON.stringify({ scope: "agentledger", message: "jev assessment failed", product_id: product.id, error: String(error) }));
    return null;
  }
  const assessmentRaw = typeof assessment.raw === "object" && assessment.raw !== null ? (assessment.raw as Record<string, unknown>) : { response: assessment.raw };
  await db.from("risk_assessments").insert({
    principal_id: principalId,
    intent_id: intentId,
    product_id: product.id,
    provider: "jev",
    model: assessment.model,
    prompt_injection: assessment.promptInjection,
    crypto_exfiltration: assessment.cryptoExfiltration,
    price_anomaly: assessment.priceAnomaly,
    content_hash: hash,
    raw: { ...assessmentRaw, ...chainRawFields(trust, verified, assessment.merchantRisk) },
  });
  return {
    promptInjection: assessment.promptInjection,
    cryptoExfiltration: assessment.cryptoExfiltration,
    priceAnomaly: assessment.priceAnomaly,
    merchantRisk: assessment.merchantRisk,
    merchantTrustScore: trust.score,
    merchantTrustSource: trust.source,
    merchantTrustCheckedAt: trust.checkedAt,
    merchantVerified: verified,
    provider: "jev",
    model: assessment.model,
    cached: false,
  };
}

export interface GuardrailPolicyRow {
  min_trust_score?: number | null;
  trusted_domain_overrides?: string[] | null;
  price_anomaly_deny_threshold?: number | string | null;
  price_anomaly_review_threshold?: number | string | null;
  injection_kill_threshold?: number | string | null;
  kill_switch_enabled?: boolean | null;
  require_verified_merchant?: boolean | null;
  allowed_domains?: string[] | null;
  blocked_categories?: string[] | null;
  allowed_categories?: string[] | null;
  market_price_tolerance?: number | string | null;
}

export async function getAgentStatus(db: SupabaseClient, agentId: string): Promise<"active" | "disabled" | "suspended"> {
  const { data, error } = await db.from("agents").select("status").eq("id", agentId).maybeSingle();
  if (error || !data) return "disabled"; // unknown agent state ⇒ fail closed
  const s = String(data.status);
  return s === "active" || s === "suspended" ? s : "disabled";
}

function storedTrustScore(product: ProductRow): number | null {
  const stored = product.merchants.trust_score;
  if (stored === null || stored === undefined) return null;
  const n = Number(stored);
  return Number.isFinite(n) ? n : null;
}

export function runGuardrails(
  agentStatus: "active" | "disabled" | "suspended",
  product: ProductRow,
  policy: GuardrailPolicyRow | null,
  risk: RiskSignals | null,
  purchase: { quantity: number },
): GuardrailResult {
  const result = evaluateGuardrailsFor(agentStatus, product, policy, risk, purchase);
  // Verified Merchant Registry: when the human requires it, unverified merchants are denied.
  const verified = product.merchants.verified === true;
  result.checks.merchant_verified = { passed: verified || !policy?.require_verified_merchant, required: policy?.require_verified_merchant === true, verified };
  if (policy?.require_verified_merchant && !verified) result.violations.push("MERCHANT_NOT_VERIFIED");
  // Full real-time risk chain for the audit trail and UI:
  // "ScamAdviser <score> → Jev merchantRisk <p> → Policy <decision>".
  const chainDecision = result.violations.length > 0 ? "deny" : result.requireApproval ? "require_approval" : "pass";
  result.checks.risk_chain = {
    passed: result.violations.length === 0,
    scamadviser: {
      score: risk ? risk.merchantTrustScore : storedTrustScore(product),
      source: risk ? risk.merchantTrustSource : product.merchants.trust_score_source ?? "unavailable",
      checkedAt: risk ? risk.merchantTrustCheckedAt : null,
    },
    jev: risk
      ? {
          model: risk.model,
          promptInjection: risk.promptInjection,
          cryptoExfiltration: risk.cryptoExfiltration,
          priceAnomaly: risk.priceAnomaly,
          merchantRisk: risk.merchantRisk,
        }
      : null,
    decision: chainDecision,
  };
  return result;
}

export function productCategory(product: ProductRow): string {
  const row = product as ScenarioProductRow;
  const c = row.category;
  return typeof c === "string" && c.length > 0 ? c : "software";
}

function productMarketPriceCents(product: ProductRow): number | null {
  const row = product as ScenarioProductRow;
  const v = row.market_price_cents;
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function evaluateGuardrailsFor(
  agentStatus: "active" | "disabled" | "suspended",
  product: ProductRow,
  policy: GuardrailPolicyRow | null,
  risk: RiskSignals | null,
  purchase: { quantity: number },
): GuardrailResult {
  const num = (v: unknown, d: number) => (v === null || v === undefined || Number.isNaN(Number(v)) ? d : Number(v));
  const defaultBlocked = ["crypto", "gift_card", "wire_transfer"];
  return evaluateGuardrails({
    agentStatus,
    merchant: {
      slug: product.merchants.slug,
      domain: product.merchants.domain ?? null,
      // Prefer the trust refreshed at assessment time (live ScamAdviser / fixture) over the row
      // loaded with the product, which may be stale.
      trustScore: risk ? risk.merchantTrustScore : storedTrustScore(product),
      trustSource: risk ? risk.merchantTrustSource : product.merchants.trust_score_source ?? "unavailable",
    },
    purchase: {
      category: productCategory(product),
      unitPriceCents: product.price_cents,
      quantity: purchase.quantity,
      external: isExternalProduct(product),
    },
    productMarketPriceCents: productMarketPriceCents(product),
    policy: {
      minTrustScore: num(policy?.min_trust_score, 95),
      trustedDomainOverrides: policy?.trusted_domain_overrides ?? [],
      priceAnomalyDenyThreshold: num(policy?.price_anomaly_deny_threshold, 0.8),
      priceAnomalyReviewThreshold: num(policy?.price_anomaly_review_threshold, 0.5),
      injectionKillThreshold: num(policy?.injection_kill_threshold, 0.9),
      killSwitchEnabled: policy?.kill_switch_enabled ?? true,
      allowedDomains: policy?.allowed_domains ?? [],
      blockedCategories: policy?.blocked_categories ?? defaultBlocked,
      allowedCategories: policy?.allowed_categories ?? [],
      marketPriceTolerance: num(policy?.market_price_tolerance, 1.5),
    },
    risk: risk
      ? {
          promptInjection: risk.promptInjection,
          cryptoExfiltration: risk.cryptoExfiltration,
          priceAnomaly: risk.priceAnomaly,
          merchantRisk: risk.merchantRisk,
        }
      : null,
  });
}

/** Suspends the agent immediately. Every later proposal is denied (AGENT_SUSPENDED) until the human re-enables it. */
export async function triggerKillSwitch(
  db: SupabaseClient,
  principalId: string,
  agentId: string,
  intentId: string,
  reason: string,
): Promise<void> {
  await db
    .from("agents")
    .update({ status: "suspended", suspended_at: new Date().toISOString(), suspended_reason: reason })
    .eq("id", agentId)
    .eq("owner_id", principalId);
  await appendAuditEvent(db, {
    principalId,
    agentId,
    intentId,
    eventType: "AGENT_KILL_SWITCH_TRIGGERED",
    eventData: { reason, effect: "Agent suspended. All further actions are denied until a human re-enables it." },
  });
  console.log(JSON.stringify({ scope: "agentledger", message: "kill switch triggered", intent_id: intentId, agent_id: agentId }));
}

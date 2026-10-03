// Guardrail gate: external signals (Jev, merchant trust score) in → deterministic guardrail rules out.
// Runtime-agnostic. A missing/failed signal never auto-approves (see lib/policy/guardrails.ts).
import type { SupabaseClient } from "@supabase/supabase-js";
import { evaluateGuardrails, type GuardrailResult } from "../policy/guardrails.ts";
import { assessListing, contentHash, type AssessListingInput, type JevAssessment } from "../risk/jev.ts";
import { appendAuditEvent } from "./audit.ts";
import type { ProductRow } from "./products.ts";

export interface RiskSignals {
  promptInjection: number;
  cryptoExfiltration: number;
  priceAnomaly: number;
  provider: string;
  model: string;
  cached: boolean;
}

function listingInput(product: ProductRow): AssessListingInput {
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
  };
}

/** Jev assessment for a listing, cached per (product, content hash). Returns null when unavailable. */
export async function assessProductRisk(
  db: SupabaseClient,
  principalId: string,
  product: ProductRow,
  jevApiKey: string | null | undefined,
  intentId: string | null,
): Promise<RiskSignals | null> {
  const input = listingInput(product);
  let hash: string;
  try {
    hash = await contentHash(input);
  } catch {
    return null;
  }
  const { data: cached } = await db
    .from("risk_assessments")
    .select("prompt_injection, crypto_exfiltration, price_anomaly, provider, model")
    .eq("product_id", product.id)
    .eq("content_hash", hash)
    .order("created_at", { ascending: false })
    .limit(1);
  const hit = cached?.[0] as
    | { prompt_injection: number; crypto_exfiltration: number; price_anomaly: number; provider: string; model: string }
    | undefined;

  if (hit) {
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
        raw: { cached: true },
      });
    }
    return {
      promptInjection: Number(hit.prompt_injection),
      cryptoExfiltration: Number(hit.crypto_exfiltration),
      priceAnomaly: Number(hit.price_anomaly),
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
    raw: assessment.raw as object,
  });
  return {
    promptInjection: assessment.promptInjection,
    cryptoExfiltration: assessment.cryptoExfiltration,
    priceAnomaly: assessment.priceAnomaly,
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
}

export async function getAgentStatus(db: SupabaseClient, agentId: string): Promise<"active" | "disabled" | "suspended"> {
  const { data, error } = await db.from("agents").select("status").eq("id", agentId).maybeSingle();
  if (error || !data) return "disabled"; // unknown agent state ⇒ fail closed
  const s = String(data.status);
  return s === "active" || s === "suspended" ? s : "disabled";
}

export function runGuardrails(
  agentStatus: "active" | "disabled" | "suspended",
  product: ProductRow,
  policy: GuardrailPolicyRow | null,
  risk: RiskSignals | null,
): GuardrailResult {
  const num = (v: unknown, d: number) => (v === null || v === undefined || Number.isNaN(Number(v)) ? d : Number(v));
  return evaluateGuardrails({
    agentStatus,
    merchant: {
      slug: product.merchants.slug,
      domain: product.merchants.domain ?? null,
      trustScore: product.merchants.trust_score === null || product.merchants.trust_score === undefined ? null : Number(product.merchants.trust_score),
      trustSource: product.merchants.trust_score_source ?? "unavailable",
    },
    policy: {
      minTrustScore: num(policy?.min_trust_score, 95),
      trustedDomainOverrides: policy?.trusted_domain_overrides ?? [],
      priceAnomalyDenyThreshold: num(policy?.price_anomaly_deny_threshold, 0.8),
      priceAnomalyReviewThreshold: num(policy?.price_anomaly_review_threshold, 0.5),
      injectionKillThreshold: num(policy?.injection_kill_threshold, 0.9),
      killSwitchEnabled: policy?.kill_switch_enabled ?? true,
    },
    risk: risk ? { promptInjection: risk.promptInjection, cryptoExfiltration: risk.cryptoExfiltration, priceAnomaly: risk.priceAnomaly } : null,
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

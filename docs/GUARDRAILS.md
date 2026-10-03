# AgentLedger Guardrails (phase 2) — spec

Principle: **signals in, deterministic decision out.** External scorers (Jev, ScamAdvisor) produce numeric
signals. Deterministic code compares them to human-configured thresholds. A model never makes the final call.
Missing/failed signals fail toward safety (deny or human approval), never toward auto-approve.

## 1. Signals

### Jev (TypeSafe System One) — `lib/risk/jev.ts`
`POST https://api.typesafe.ai/v1/systemone`, `Authorization: Bearer ${JEV_API_KEY}`, body
`{ model: "jev-latest", state: {...}, questions: { key: { type: "noul", instructions } } }` →
`{ model, answers: { key: { type: "noul", noul: 0..1 } }, usage }`. Verified working with the project key
(prompt-injection probe returned 0.99). Server-only; key read from env; never logged.

```ts
export interface JevAssessment {
  provider: "jev"; model: string;
  promptInjection: number;     // P(merchant content tries to instruct/manipulate an AI agent)
  cryptoExfiltration: number;  // P(content asks to pay/send crypto or funds to a wallet/address/off-platform destination)
  priceAnomaly: number;        // P(listed price is far above typical market price for this kind of product/term)
  raw: unknown;
}
export async function assessListing(input: { productName: string; merchantName: string; merchantDomain: string | null;
  description: string; metadata: unknown; priceCents: number; currency: string; recurring: boolean; requestsPerMonth: number | null },
  opts: { apiKey: string; fetchImpl?: typeof fetch; timeoutMs?: number }): Promise<JevAssessment>
```
One HTTP call with three `noul` questions. `state` holds ONLY the listing fields (merchant text is data).
Price question instructions must ask Jev to compare against typical market pricing for API plans of that
request volume/term (e.g. "Typical developer API plans of ~100k requests/month cost $5–$50/month").
Timeout default 8s. Throws on non-2xx / malformed responses (caller fails safe).

### ScamAdvisor — `lib/risk/scamadvisor.ts`
```ts
export interface TrustScore { domain: string; score: number | null; source: "scamadvisor" | "fixture" | "unavailable"; checkedAt: string }
export interface TrustScoreProvider { score(domain: string): Promise<TrustScore> }
export class ScamAdvisorProvider implements TrustScoreProvider // uses SCAMADVISOR_API_KEY; endpoint configurable via SCAMADVISOR_API_URL; returns source "unavailable" + score null on any error
```
No ScamAdvisor key exists yet: merchants carry a stored `trust_score` + `trust_score_source`. Seed merchants are
fictional demo domains, so their scores are stored with `trust_score_source = 'fixture'` and labelled
"demo fixture" in the UI. Never present fixture scores as ScamAdvisor results.

## 2. Database — new migration `supabase/migrations/20261003010000_guardrails.sql`
- `merchants`: add `domain text`, `trust_score numeric(5,2)`, `trust_score_source text not null default 'unavailable' check in ('scamadvisor','fixture','unavailable')`, `trust_scored_at timestamptz`.
  Fixture values: acme-api `acme-api.dev` 98; vectorbase `vectorbase.io` 97; devhost `devhost.app` 96; cheapcompute `cheapcompute.net` 91; evil-cloud `evil-cloud-deals.xyz` 12.
- `delegations`: add `min_trust_score integer not null default 95 check (between 0 and 100)`,
  `trusted_domain_overrides text[] not null default '{}'` (human-authorized domains allowed despite score),
  `price_anomaly_deny_threshold numeric not null default 0.8`, `price_anomaly_review_threshold numeric not null default 0.5`,
  `injection_kill_threshold numeric not null default 0.9`, `kill_switch_enabled boolean not null default true`.
  Extend the authenticated column-level UPDATE grant to these columns.
- `agents`: allow status `suspended` (alter type agent_status add value 'suspended'), add `suspended_at timestamptz`, `suspended_reason text`.
  Authenticated users may UPDATE only `status` of their own agents (to re-enable), via column grant + RLS policy `owner_id = auth.uid()`.
- `risk_assessments(id, principal_id, intent_id uuid null, product_id uuid, provider text, model text, prompt_injection numeric, crypto_exfiltration numeric, price_anomaly numeric, content_hash text, raw jsonb, created_at)`; RLS select own; realtime broadcast like other tables; index (product_id, content_hash).
- Realtime broadcast trigger on `agents` updates → topic `user:<owner_id>`.
- `reset_demo` must also un-suspend the principal's agents and reset the new delegation columns to defaults (create or replace the function, keeping its existing behaviour).

## 3. Deterministic guardrail rules — `lib/policy/guardrails.ts` (pure, runtime-agnostic, `.ts` relative imports)
```ts
export type GuardrailViolation = "AGENT_SUSPENDED" | "MERCHANT_TRUST_TOO_LOW" | "MERCHANT_TRUST_UNKNOWN"
  | "PROMPT_INJECTION_DETECTED" | "CRYPTO_EXFILTRATION_DETECTED" | "PRICE_ANOMALY";
export interface GuardrailInput {
  agentStatus: "active" | "disabled" | "suspended";
  merchant: { slug: string; domain: string | null; trustScore: number | null; trustSource: string };
  policy: { minTrustScore: number; trustedDomainOverrides: string[]; priceAnomalyDenyThreshold: number;
            priceAnomalyReviewThreshold: number; injectionKillThreshold: number; killSwitchEnabled: boolean };
  risk: { promptInjection: number; cryptoExfiltration: number; priceAnomaly: number } | null; // null = Jev unavailable
}
export interface GuardrailResult {
  violations: GuardrailViolation[];          // any ⇒ deny
  requireApproval: boolean;                  // escalate to human even if amount ≤ threshold
  killSwitch: { trigger: boolean; reason: string | null };
  checks: Record<string, { passed: boolean; [k: string]: unknown }>; // for UI/audit
}
export function evaluateGuardrails(input: GuardrailInput): GuardrailResult
```
Rules: agent not active ⇒ AGENT_SUSPENDED. Domain in overrides ⇒ trust passes. Else score null ⇒
MERCHANT_TRUST_UNKNOWN; score < min ⇒ MERCHANT_TRUST_TOO_LOW. risk null ⇒ requireApproval (fail toward human).
promptInjection ≥ injectionKillThreshold ⇒ PROMPT_INJECTION_DETECTED; cryptoExfiltration ≥ injectionKillThreshold ⇒
CRYPTO_EXFILTRATION_DETECTED. priceAnomaly ≥ deny ⇒ PRICE_ANOMALY; ≥ review ⇒ requireApproval.
Kill switch triggers when killSwitchEnabled AND (PROMPT_INJECTION_DETECTED or CRYPTO_EXFILTRATION_DETECTED) is
present AND the agent actually proposed that action (the evaluator is only called on proposals, so: whenever
those violations occur). Reason string names the signal and score.

## 4. Pipeline integration (lead) — `lib/domain/pipeline.ts`
On propose: load merchant trust + delegation guardrail columns + agent status; get Jev assessment (cached in
risk_assessments by product_id + content hash; Jev error ⇒ risk null); run `evaluateAction` AND
`evaluateGuardrails`; deny if either denies (violations merged); require approval if either requires; record
both in policy_decisions.rules_evaluated (`guardrails` key). On kill switch: set agent `suspended`, audit
`AGENT_KILL_SWITCH_TRIGGERED`, every later proposal ⇒ AGENT_SUSPENDED until the human re-enables
(`AGENT_REENABLED` audit). Search marks products with Jev scores (audit `UNTRUSTED_CONTENT_ENCOUNTERED` includes them).
Playground agent loop stops as soon as a tool result reports the kill switch.

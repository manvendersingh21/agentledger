# AgentLedger Architecture

AgentLedger sits between an AI agent and money. The agent can only *propose*; deterministic server code decides, a human approves when required, and an idempotent executor performs the payment. Every step is recorded in a tamper-evident audit chain.

## 1. System diagram

```
  ┌──────────────────┐   sign-in    ┌───────────────┐   owns    ┌──────────────────────────┐
  │ Human Principal  │─────────────▶│ Supabase Auth │──────────▶│ Delegation Policy         │
  │ (browser)        │              │ (identity)    │           │ limits, allowlist,        │
  └────────┬─────────┘              └───────┬───────┘           │ recurring, guardrail      │
           │ approve / deny                 │ OAuth 2.1         │ thresholds, kill switch   │
           │                                │ (MCP clients)     └─────────────┬────────────┘
           │                                ▼                                 │
           │      ┌────────────────────────────────────────┐                  │
           │      │ Agent  (untrusted)                     │                  │
           │      │  - OpenAI Responses API (playground)   │                  │
           │      │  - MCP client (Claude Code, etc.)      │                  │
           │      └───────────────┬────────────────────────┘                  │
           │                      │ propose_purchase(product_id)              │
           │                      ▼                                           │
           │      ┌────────────────────────────────────────┐                  │
           │      │ AgentLedger (Next.js server / Edge Fn) │                  │
           │      │ lib/domain/pipeline.ts                 │                  │
           │      └───────────────┬────────────────────────┘                  │
           │                      ▼                                           │
           │      ┌────────────────────────────────────────┐                  │
           │      │ Action Intent (terms from DB, not agent)│                 │
           │      └───────────────┬────────────────────────┘                  │
           │                      ▼                                           ▼
           │      ┌──────────────────────────────────────────────────────────────┐
           │      │ Deterministic Policy  lib/policy/evaluate.ts + guardrails.ts │
           │      │   ▲ signals: Jev (injection / crypto / price anomaly)        │
           │      │   ▲ signals: ScamAdvisor trust score / fixture / registry    │
           │      └───────┬─────────────────────┬─────────────────────┬──────────┘
           │              ▼                     ▼                     ▼
           │            DENY                  HUMAN                 AUTO
           │              │                     │                     │
           │              │      Realtime approval card               │
           └──────────────┼────────▶ (private broadcast user:<uid>)   │
                          │                     │ approved            │
                          │                     ▼                     ▼
                          │      ┌────────────────────────────────────────┐
                          │      │ Executor: claim_execution RPC (atomic) │
                          │      │ + Stripe Idempotency-Key               │──▶ Stripe (test mode)
                          │      └───────────────┬────────────────────────┘
                          │                      ▼
                          │                   Receipt
                          ▼                      ▼
          ┌──────────────────────────────────────────────────────────────┐
          │ Audit Event Chain: SHA-256(prev_hash + canonical event),      │
          │ per principal, append-only, unique(principal_id, prev_hash)   │
          └──────────────────────────────────────────────────────────────┘
```

## 2. Components and files

| Area | Files | Notes |
| --- | --- | --- |
| Schema, RLS, RPCs, triggers | `supabase/migrations/20261003000000_agentledger.sql` | Core ledger tables, state-machine trigger, append-only audit, `claim_execution`, `resolve_approval`, `daily_committed_spend`, `reset_demo`, `ensure_principal_setup`, Realtime broadcast triggers |
| Guardrails schema | `supabase/migrations/20261003010000_guardrails.sql` | Merchant trust columns, delegation thresholds, agent `suspended`, `risk_assessments` |
| Merchant registry schema | `supabase/migrations/20261003020000_merchant_registry.sql` | `merchants.verified`, `merchant_registrations`, `require_verified_merchant` |
| Seed | `supabase/seed.sql`, `supabase/seed-fixtures.sql` | Merchants/products incl. Evil Cloud injection listing, local demo user; fixture trust scores labelled `fixture` |
| Policy (pure) | `lib/policy/evaluate.ts`, `lib/policy/guardrails.ts`, `lib/policy/types.ts` | Runtime-agnostic, no LLM, no I/O |
| State machine (pure) | `lib/ledger/state-machine.ts` | Mirrors the DB trigger |
| Audit chain (pure) | `lib/crypto/audit-chain.ts`, `lib/domain/audit.ts` | Web Crypto SHA-256, canonical JSON, verification |
| Orchestration | `lib/domain/pipeline.ts`, `lib/domain/guardrail-gate.ts`, `lib/domain/products.ts` | Propose, approve, execute, duplicate path, kill switch |
| Risk signals | `lib/risk/jev.ts`, `lib/risk/scamadvisor.ts` | Jev System One client; ScamAdvisor provider (returns `unavailable` on error) |
| Payments | `lib/payments/provider.ts` | Stripe (test keys only) and labelled demo provider; fetch-only |
| Agent | `lib/agent/openai-provider.ts`, `lib/agent/types.ts`, `lib/agent/bind-tools.ts`, `lib/agent/prompts.ts` | `AgentProvider` interface; `OpenAIAgentProvider` uses the Vercel AI SDK `ToolLoopAgent` over the OpenAI Responses API (`OPENAI_API_KEY`, `AGENT_MODEL`, default `gpt-5.4-mini`) |
| MCP | `lib/mcp/tools.ts`, `app/api/mcp/route.ts`, `supabase/functions/mcp/index.ts` | Shared tool definitions + JSON-RPC handler; local Next route and Edge Function |
| Registry | `lib/registry/verify.ts`, `lib/registry/registry.ts`, `app/api/registry/**` | DNS TXT / well-known verification with SSRF guards |
| HTTP API | `app/api/agent/run`, `app/api/approvals/[id]`, `app/api/actions/[id]/execute`, `app/api/delegations`, `app/api/audit/verify`, `app/api/agents/[id]/reenable`, `app/api/attack/[scenario]`, `app/api/demo/reset` | All authenticate the user server-side first |
| Realtime client | `lib/realtime/use-ledger-realtime.ts` | Subscribes to private `user:<uid>` |
| Supabase clients | `lib/supabase/{client,server,admin}.ts` | `admin.ts` (secret key) is server-only |
| Scripts | `scripts/mcp-smoke.ts`, `scripts/probe-jev.ts` | MCP end-to-end smoke test; Jev probe |

## 3. Trust boundaries

| Trusted | Untrusted |
| --- | --- |
| Supabase Auth identity (session / OAuth access token) | LLM output, including tool-call arguments |
| Product data in the database (price, merchant, recurrence) | Merchant content: descriptions, metadata, promo notes |
| Server-side policy config (delegation rows, thresholds) | Tool arguments from any agent or MCP client |
| Server executor and its credentials | Browser payloads (ids, amounts, principal ids) |
| | External APIs (Jev, ScamAdvisor, DNS, well-known fetches, Stripe responses are validated) |

Consequences: the principal is always derived from the verified token, never from arguments. Amount, currency, merchant and recurrence are loaded from `products`; agent-supplied `claimed_*` values are compared and mismatches recorded as tampering. Merchant text is passed to Jev as data, never as instructions to the agent's controller.

## 4. Intent state machine

```
                ┌──────────┐
                │ proposed │
                └────┬─────┘
                     ▼
               ┌────────────┐
               │ evaluating │
               └─┬────┬───┬─┘
         ┌───────┘    │   └──────────────┐
         ▼            ▼                  ▼
     ┌────────┐ ┌───────────────────┐ ┌──────────┐
     │ denied │◀│ awaiting_approval │─▶│ approved │
     └────────┘ └─────────┬─────────┘ └─┬────┬───┘
         ▲                ▼             │    │
         │           ┌─────────┐        │    │
         │           │ expired │        │    │
         │           └─────────┘        │    ▼
         └──────────────────────────────┘ ┌───────────┐
           (re-evaluation failure)        │ executing │
                                          └─┬───────┬─┘
                                            ▼       ▼
                                      ┌──────────┐ ┌────────┐
                                      │ executed │ │ failed │
                                      └──────────┘ └────────┘
```

Allowed transitions:

- `proposed → evaluating`
- `evaluating → denied | awaiting_approval | approved`
- `awaiting_approval → approved | denied | expired`
- `approved → executing | denied` (denied only on re-evaluation failure before execution)
- `executing → executed | failed`
- Same-status updates are no-ops. `denied`, `executed`, `failed`, `expired`, `duplicate` are terminal.

Enforced twice: `lib/ledger/state-machine.ts` (`assertTransition`) in application code, and a `BEFORE UPDATE OF status` trigger on `action_intents` that raises `INVALID_STATE_TRANSITION <from> -> <to>`. The trigger holds even if a server bug or a direct service-role write tries to skip a step.

## 5. Policy precedence

1. `evaluateAction` (hard rules) collects **all** violations in a stable order: `NO_ACTIVE_DELEGATION`, `ACTION_NOT_DELEGATED`, `INVALID_AMOUNT`, `CURRENCY_NOT_ALLOWED`, `TRANSACTION_LIMIT_EXCEEDED`, `DAILY_LIMIT_EXCEEDED`, `RECURRING_NOT_ALLOWED`, `MERCHANT_NOT_ALLOWED`.
2. `evaluateGuardrails` adds `AGENT_SUSPENDED`, `MERCHANT_TRUST_TOO_LOW`, `MERCHANT_TRUST_UNKNOWN`, `PROMPT_INJECTION_DETECTED`, `CRYPTO_EXFILTRATION_DETECTED`, `PRICE_ANOMALY`.
3. Violations are merged. **Any violation ⇒ DENY** (deny wins over everything).
4. Otherwise **REQUIRE HUMAN** if amount > approval threshold, price anomaly ≥ review threshold, or Jev is unavailable.
5. Otherwise **AUTO-APPROVE**.

Empty merchant allowlist denies all. Any exception inside evaluation denies. Both rule sets are stored in `policy_decisions.rules_evaluated` (guardrails under the `guardrails` key) with `policy_version`.

## 6. Idempotency and replay

- `action_intents unique (principal_id, idempotency_key)`; `executions` has `unique (intent_id)` and `unique (idempotency_key)`; `receipts unique (intent_id)` and `unique (execution_id)`.
- `claim_execution(intent_id, idempotency_key, provider)` (security definer, service role only) atomically flips `approved → executing` and inserts the execution row. Under concurrency exactly one caller gets `claimed = true`.
- The executor passes the execution's idempotency key to Stripe as the `Idempotency-Key` header, so even a retried HTTP call cannot create a second charge.
- Duplicate path: if the intent is already `executing`/`executed`, or the claim is lost, the pipeline returns `status: "duplicate"`, records `DUPLICATE_EXECUTION_BLOCKED` in the audit chain, and makes no provider call. The UI shows **DUPLICATE EXECUTION BLOCKED, $0 additional charge**.
- `resolve_approval` is single-use: a second resolution returns `resolved = false`; another principal's approval raises `NOT_AUTHORIZED`.

## 7. RLS and privileged paths

- RLS is enabled on every table. `authenticated` may SELECT only its own rows (`principal_id = auth.uid()`, `owner_id` for agents/registrations, `id` for profiles). Merchants and products are readable.
- `authenticated` has **no** INSERT/UPDATE/DELETE on intents, decisions, approvals, executions, receipts or audit events.
- Column-restricted UPDATE grants let users edit their own delegation limits/thresholds and re-enable their own agents (`status` only).
- All ledger writes run server-side with the Supabase secret (service-role) key **after** the server has authenticated the user (`lib/supabase/admin.ts` imports `server-only`). The key is never sent to the browser or the agent.
- Privileged RPCs have EXECUTE revoked from `public`/`anon`/`authenticated` and granted to `service_role` only.

## 8. Realtime

AFTER INSERT/UPDATE triggers on `action_intents`, `approvals`, `executions`, `receipts`, `audit_events` (insert), `risk_assessments` and `agents` call `realtime.broadcast_changes('user:' || principal_id, ...)`. An RLS policy on `realtime.messages` allows `authenticated` to receive only when `realtime.topic() = 'user:' || auth.uid()`. Clients subscribe with `{ config: { private: true } }` after `realtime.setAuth(access_token)`. Approval cards, timelines and kill-switch state update live.

## 9. Tamper-evident audit chain

- Each event: `event_hash = SHA-256(previous_hash || canonicalJson({id, event_type, principal_id, agent_id, intent_id, event_data, created_at}))`. Canonical JSON sorts keys and drops undefined.
- Chains are **per principal**; genesis `previous_hash` is 64 zeros.
- `unique (principal_id, previous_hash)` prevents forks: two writers racing for the same tip cannot both append; the loser retries on the new tip (`lib/domain/audit.ts`).
- `event_hash` is unique; a BEFORE UPDATE/DELETE trigger rejects modification (except inside `reset_demo`, which sets a transaction-local flag).
- `audit_events.intent_id` has no FK cascade, so audit history survives intent deletion.
- `verifyAuditChain` walks `previous_hash` links from genesis (not `created_at`) and recomputes every hash; `/api/audit/verify` reports **AUDIT INTEGRITY VERIFIED** or the first broken event.

This is tamper-evident, not tamper-proof: a database superuser could rewrite the whole chain, but any partial edit is detected.

## 10. MCP

- Tools: `list_delegations`, `search_products`, `propose_purchase`, `get_action_status`, `get_receipt`. Defined once in `lib/mcp/tools.ts` with a shared JSON-RPC handler.
- **Deploy target**: Supabase Edge Function `supabase/functions/mcp` (Deno). It imports the same runtime-agnostic `lib/` modules (hence `.ts` relative imports, Web Crypto, fetch-only payments). Deploy with `supabase functions deploy mcp --no-verify-jwt` and secrets `STRIPE_SECRET_KEY`, `JEV_API_KEY`, `PAYMENT_PROVIDER`. The function serves OAuth protected-resource metadata and requires a valid Supabase user JWT itself.
- **Local**: the edge runtime is disabled in `supabase/config.toml` (`[edge_runtime] enabled = false`, Docker Desktop bind-mount issue), and the stack is started with `pnpm exec supabase start -x vector,logflare`. MCP is served by the Next route `app/api/mcp/route.ts` at `http://localhost:3000/api/mcp`, which returns `401` with `WWW-Authenticate: Bearer resource_metadata=...` when unauthenticated.
- Auth: Supabase Auth OAuth 2.1 server (`[auth.oauth_server]`, consent at `/oauth/consent`). The token's user is the principal; tool arguments never carry identity.
- Verified: `scripts/mcp-smoke.ts` proposes the $500 Evil Cloud purchase over MCP and it is denied.

## 11. Jev guardrails

Signals in, deterministic decision out.

1. On proposal, the pipeline sends only listing fields (name, merchant, domain, description, metadata, price, recurrence, volume) to Jev with three `noul` questions: prompt injection, crypto exfiltration, price anomaly (compared against typical API plan pricing).
2. Results are cached in `risk_assessments` by `(product_id, content_hash)`.
3. `evaluateGuardrails` compares scores with the delegation's thresholds (defaults: kill 0.9, price deny 0.8, price review 0.5, min trust 95).
4. **Kill switch** (`kill_switch_enabled`, default on): `PROMPT_INJECTION_DETECTED` or `CRYPTO_EXFILTRATION_DETECTED` on a proposed action sets the agent to `suspended` and audits `AGENT_KILL_SWITCH_TRIGGERED`. Every later proposal is denied with `AGENT_SUSPENDED` until the human re-enables it (`AGENT_REENABLED`). The playground loop stops as soon as a tool result reports the kill switch.

Observed: Evil Cloud injection 0.99, price anomaly 0.93; legitimate listings ≤ 0.10.

Merchant trust comes from the stored `merchants.trust_score` (the policy reads the stored value; `lib/risk/scamadvisor.ts` is the provider for populating it once a key exists) with `trust_score_source` in `scamadvisor | fixture | unavailable`. Domains in `trusted_domain_overrides` bypass the score check by explicit human choice.

## 12. Failure modes

| Failure | Behaviour | Direction |
| --- | --- | --- |
| Exception inside policy evaluation | Decision = deny | Fail closed |
| No / expired / disabled delegation | `NO_ACTIVE_DELEGATION` deny | Fail closed |
| Empty merchant allowlist | All merchants denied | Fail closed |
| Jev timeout, error, or missing key | `risk = null` ⇒ require human approval | Toward human |
| Merchant has no trust score (`unavailable`; `ScamAdvisorProvider` also returns `null` on error) | `MERCHANT_TRUST_UNKNOWN` deny, unless the domain is in `trusted_domain_overrides` | Fail closed |
| Agent supplies different amount/merchant/recurrence | DB terms used; tampering recorded | Ignore untrusted input |
| Unknown or inactive product | Rejected, no intent created | Fail closed |
| Invalid status transition | DB trigger raises | Fail closed |
| Concurrent execute / retry / replay | One claim wins; others get duplicate result, no provider call | At most once |
| Stripe network error or non-success status | Execution `failed`, intent `failed`, no receipt | Fail closed |
| Live Stripe key or `livemode: true` response | Provider refuses | Fail closed |
| Audit append race | Unique constraint rejects fork; retry on new tip | Integrity preserved |
| Audit row modified | Trigger rejects; verification reports break | Detectable |
| Missing service-role key / Supabase URL | Server returns 500, nothing executes | Fail closed |
| Unauthenticated MCP request | 401 with resource metadata | Fail closed |
| Registry check targets IP/localhost/private host or redirects off-host | Verification refused | Fail closed |

# AgentLedger Architecture

AgentLedger sits between an AI agent and money. The agent can only *propose*; deterministic server code decides, a human approves when required, and an idempotent executor performs the payment. Every step is recorded in a tamper-evident audit chain.

- Live application: [https://agentledger-cyan.vercel.app](https://agentledger-cyan.vercel.app)
- Hosted MCP: `https://lxxzfaitasfjsqcrhven.supabase.co/functions/v1/mcp`

There is one purchase engine. Concierge, grocery and restaurant automations, software purchases, external-site proposals and MCP clients are adapters around the same state machine:

```text
intent → authoritative terms → deterministic policy → human approval when needed
       → idempotent Stripe test execution → receipt → tamper-evident audit
```

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
           │      │ Agent / adapter (untrusted)             │                  │
           │      │  - Concierge / groceries / inventory   │                  │
           │      │  - OpenAI playground / MCP client      │                  │
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
           │      │   ▲ limits, recurrence, merchants, sites, categories, price  │
           │      │   ▲ Jev + ScamAdviser/fixture trust + registry verification  │
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
| Stripe event log | `supabase/migrations/20261003030000_stripe_events.sql` | Idempotent, service-role-only webhook event ingestion |
| Website policy | `supabase/migrations/20261003040000_allowed_websites.sql` | Delegation `allowed_domains` |
| Scenario schema | `supabase/migrations/20261003050000_scenarios.sql` | Categories, market-price references, hash-bound approvals, restaurant inventory |
| Merchant Network schema | `supabase/migrations/20261003060000_merchant_network.sql` | Hashed merchant API keys, feed/external product sources, merchant applications, feed upsert RPC |
| Grocery schema | `supabase/migrations/20261003070000_groceries.sql` | Household lists, weekly budgets, due dates, RLS and Realtime |
| Seed | `supabase/seed.sql`, `supabase/seed-fixtures.sql` | Merchants/products incl. Evil Cloud injection listing, local demo user; fixture trust scores labelled `fixture` |
| Policy (pure) | `lib/policy/evaluate.ts`, `lib/policy/guardrails.ts`, `lib/policy/types.ts` | Runtime-agnostic, no LLM, no I/O |
| State machine (pure) | `lib/ledger/state-machine.ts` | Mirrors the DB trigger |
| Audit chain (pure) | `lib/crypto/audit-chain.ts`, `lib/domain/audit.ts` | Web Crypto SHA-256, canonical JSON, verification |
| Orchestration | `lib/domain/pipeline.ts`, `lib/domain/guardrail-gate.ts`, `lib/domain/products.ts` | Propose, approve, execute, duplicate path, kill switch |
| Use-case adapters | `lib/domain/groceries.ts`, `lib/domain/inventory.ts`, `lib/domain/external.ts`, `lib/domain/recipes.ts` | Deterministic basket/restock planning, external proposals and recipe planning; all purchase-capable paths call the core pipeline |
| Playbooks and concierge | `lib/agent/playbooks.ts`, `lib/agent/concierge.ts`, `app/api/agent/chat/route.ts` | Normalized fan/DIY/grocery/recipe/restaurant/software/external playbooks and a multi-turn `ask_user` concierge |
| Risk signals | `lib/risk/jev.ts`, `lib/risk/scamadvisor.ts`, `lib/risk/scamadviser-scrape.ts`, `lib/risk/trust-refresh.ts` | Jev System One; live ScamAdviser public-page parsing with a 24-hour cache; explicit fixture/unavailable sources |
| Payments | `lib/payments/provider.ts` | Stripe (test keys only) and labelled demo provider; fetch-only |
| Agent | `lib/agent/openai-provider.ts`, `lib/agent/types.ts`, `lib/agent/bind-tools.ts`, `lib/agent/prompts.ts` | `AgentProvider` interface; `OpenAIAgentProvider` uses the Vercel AI SDK `ToolLoopAgent` over the OpenAI Responses API (`OPENAI_API_KEY`, `AGENT_MODEL`, default `gpt-5.4-mini`) |
| MCP | `lib/mcp/tools.ts`, `app/api/mcp/route.ts`, `supabase/functions/mcp/index.ts` | Shared tool definitions + JSON-RPC handler; local Next route and Edge Function |
| Registry and merchant feed | `lib/registry/verify.ts`, `lib/registry/registry.ts`, `lib/registry/api-keys.ts`, `app/api/registry/**`, `app/api/merchant/v1/products` | DNS TXT / well-known verification, SSRF guards, one-time-visible API keys and registration-scoped SKU upserts |
| HTTP API | `app/api/agent/**`, `app/api/groceries/**`, `app/api/inventory/**`, `app/api/scenarios/apply`, `app/api/approvals/[id]`, `app/api/actions/[id]/execute`, `app/api/delegations`, `app/api/audit/verify`, `app/api/agents/[id]/reenable`, `app/api/attack/[scenario]`, `app/api/demo/reset` | Authenticated product surfaces; identity is established server-side before privileged writes |
| Realtime client | `lib/realtime/use-ledger-realtime.ts` | Subscribes to private `user:<uid>` |
| Supabase clients | `lib/supabase/{client,server,admin}.ts` | `admin.ts` (secret key) is server-only |
| Scripts | `scripts/mcp-smoke.ts`, `scripts/probe-jev.ts` | MCP end-to-end smoke test; Jev probe |

## 3. Trust boundaries

| Trusted | Untrusted |
| --- | --- |
| Supabase Auth identity (session / OAuth access token) | LLM output, including tool-call arguments |
| Catalog and verified-feed product terms in the database (price, merchant, recurrence) | Merchant content: descriptions, metadata, promo notes |
| Server-side policy config (delegation rows, thresholds) | Tool arguments from any agent or MCP client |
| Server executor and its credentials | Browser payloads (ids, amounts, principal ids) |
| | External APIs (Jev, ScamAdviser, DNS, well-known fetches and Stripe responses are validated) |

Consequences: the principal is always derived from the verified token, never from arguments. Amount, currency, merchant and recurrence are loaded from catalog or verified-feed `products`; agent-supplied `claimed_*` values are compared and mismatches recorded as tampering. External products are different by design: their price is explicitly labelled **UNVERIFIED PRICE — agent-claimed** and can never auto-approve. Merchant text is passed to Jev as data, never as instructions to the agent's controller.

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
2. `evaluateGuardrails` adds agent state, merchant trust, website, category, market-reference and Jev checks: `AGENT_SUSPENDED`, `MERCHANT_TRUST_TOO_LOW`, `MERCHANT_TRUST_UNKNOWN`, `MERCHANT_NOT_VERIFIED`, `WEBSITE_NOT_ALLOWED`, `CATEGORY_BLOCKED`, `CATEGORY_NOT_ALLOWED`, `PRICE_ABOVE_MARKET`, `PROMPT_INJECTION_DETECTED`, `CRYPTO_EXFILTRATION_DETECTED`, `PRICE_ANOMALY`.
3. Default blocked categories are `crypto`, `gift_card` and `wire_transfer`. A known unit price above `market_price_tolerance × market_price_cents` (default 1.5×) is denied.
4. Violations are merged. **Any violation ⇒ DENY** (deny wins over everything).
5. Otherwise **REQUIRE HUMAN** if amount > approval threshold, Jev price anomaly ≥ review threshold, Jev is unavailable, or the product source is external/unverified.
6. External products must also match `allowed_domains` or `trusted_domain_overrides`; passing that check does not make their price authoritative.
7. Otherwise **AUTO-APPROVE**.

Empty merchant allowlist denies all. Any exception inside evaluation denies. Both rule sets are stored in `policy_decisions.rules_evaluated` (guardrails under the `guardrails` key) with `policy_version`.

Merchant trust defaults to a minimum score of 95. Domain lookup and external-purchase flows check real domains against the live public ScamAdviser page and cache the result; fictional seeded merchants use clearly labelled `fixture` scores. A fixture is never represented as a live ScamAdviser result.

## 6. Idempotency and replay

- `action_intents unique (principal_id, idempotency_key)`; `executions` has `unique (intent_id)` and `unique (idempotency_key)`; `receipts unique (intent_id)` and `unique (execution_id)`.
- `claim_execution(intent_id, idempotency_key, provider)` (security definer, service role only) atomically flips `approved → executing` and inserts the execution row. Under concurrency exactly one caller gets `claimed = true`.
- The executor passes the execution's idempotency key to Stripe as the `Idempotency-Key` header, so even a retried HTTP call cannot create a second charge.
- Duplicate path: if the intent is already `executing`/`executed`, or the claim is lost, the pipeline returns `status: "duplicate"`, records `DUPLICATE_EXECUTION_BLOCKED` in the audit chain, and makes no provider call. The UI shows **DUPLICATE EXECUTION BLOCKED, $0 additional charge**.
- `resolve_approval` is single-use: a second resolution returns `resolved = false`; another principal's approval raises `NOT_AUTHORIZED`.
- For a human-approved intent, `approvals.intent_hash` binds principal, agent, product, merchant, amount, currency, recurrence, quantity and category. `executeAction` recomputes it immediately before the claim; a mismatch denies with `APPROVAL_HASH_MISMATCH`.

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

## 10. Use-case adapters and playbooks

The adapters decide *what to propose*, never *whether it is authorized*.

| Adapter | Planning behavior | Core-engine boundary |
| --- | --- | --- |
| Concierge | Multi-turn OpenAI tool loop; `ask_user` ends a turn and renders quick replies. Normalized definitions cover fan sizing/noise/budget, owned DIY tools, groceries, recipe ingredients already on hand, restaurant supplies, software/API plans and named external sites. | `propose_purchase` / `propose_external_purchase` |
| Groceries | Due if never bought or the staple frequency elapsed; staples sort first; basket stays inside a separate weekly budget and chooses trusted delegation-allowed listings. Each line has a stable date/list/product/quantity idempotency key. | `proposePurchase` per basket line; receipt reconciliation updates `last_bought_at` |
| Restaurant inventory | A seeded busy-night simulation lowers stock. Items at or below reorder point are matched to category/search terms; the cheapest trusted allowed product is selected and quantity fills toward par. | `proposePurchase` with `channel=autopilot`; receipt reconciliation increments `on_hand` once |
| Software/API | Catalog search exposes authoritative request volume, price and recurrence while merchant text stays untrusted. | Same proposal/approval/execution pipeline |
| External website | Parses only public HTTPS hostnames and never fetches the supplied product URL. ScamAdviser is queried for the bare domain; an external product row records the claimed price and source URL. | Same pipeline, plus deterministic mandatory-human escalation |

Scenario presets set the policy around those adapters:

| Preset | Per transaction | Daily | Human above | Categories |
| --- | ---: | ---: | ---: | --- |
| Home | $150 | $300 | $60 | `home_appliance` |
| DIY | $100 | $200 | $50 | `diy_tools`, `diy_supplies` |
| Restaurant | $120 | $600 | $75 | `restaurant_food`, `restaurant_supplies` |
| Grocery | $80 | $150 | $40 | `grocery` |
| Software | $20 | $50 | $10 | unrestricted except blocked categories |

The recipe catalog and scaler are deterministic (`lib/domain/recipes.ts`), but the current concierge runtime does not register a `plan_recipe` tool or inject `buildConciergeSystemPrompt`. The recipe playbook is therefore defined and unit-tested but not yet a complete end-to-end checkout path.

## 11. MCP

- Tools: `list_delegations`, `search_products`, `propose_purchase`, `check_merchant`, `propose_external_purchase`, `get_action_status`, `get_receipt`. Defined once in `lib/mcp/tools.ts` with a shared JSON-RPC handler.
- **Deploy target**: Supabase Edge Function `supabase/functions/mcp` (Deno). It imports the same runtime-agnostic `lib/` modules (hence `.ts` relative imports, Web Crypto, fetch-only payments). Deploy with `supabase functions deploy mcp --no-verify-jwt` and secrets `STRIPE_SECRET_KEY`, `JEV_API_KEY`, `PAYMENT_PROVIDER`. The function serves OAuth protected-resource metadata and requires a valid Supabase user JWT itself.
- **Local**: the edge runtime is disabled in `supabase/config.toml` (`[edge_runtime] enabled = false`, Docker Desktop bind-mount issue), and the stack is started with `pnpm exec supabase start -x vector,logflare`. MCP is served by the Next route `app/api/mcp/route.ts` at `http://localhost:3000/api/mcp`, which returns `401` with `WWW-Authenticate: Bearer resource_metadata=...` when unauthenticated.
- Auth: Supabase Auth OAuth 2.1 server (`[auth.oauth_server]`, consent at `/oauth/consent`). The token's user is the principal; tool arguments never carry identity.
- Hosted endpoint: `https://lxxzfaitasfjsqcrhven.supabase.co/functions/v1/mcp`.
- Any remote-HTTP MCP agent can use the Merchant Network catalog after OAuth sign-in. “Any” means protocol-compatible and authenticated, not anonymous or unbounded.
- `scripts/mcp-smoke.ts` proposes the $500 Evil Cloud purchase over MCP and expects it to be denied.

## 12. Merchant Network

1. Public lookup (`/merchants`, `/api/merchants/lookup`) normalizes a public hostname, rate-limits by IP and returns AgentLedger verification plus a cached live ScamAdviser page score.
2. A signed-in merchant registers a domain and proves control with either DNS TXT at `_agentledger.<domain>` or `https://<domain>/.well-known/agentledger.json`.
3. Verification rejects IP literals, localhost/private destinations, non-HTTPS well-known URLs and cross-host redirects.
4. A verified registration can mint a one-time-visible `al_live_merchant_…` key. Only its prefix and SHA-256 hash are stored; revocation sets `revoked_at`.
5. `POST /api/merchant/v1/products` authenticates that key and upserts 1–100 USD products by registration + SKU through `upsert_merchant_feed_products`.
6. Feed products have `source=merchant_feed`, an authoritative stored price and untrusted merchant-supplied descriptions. They are immediately reachable through the normal catalog and MCP `search_products`.

Domain control is not an endorsement or partnership. Seed merchants and products are fictional fixtures; the blocked “Amazon Gift Card” fixture does not imply an Amazon relationship.

## 13. Jev guardrails

Signals in, deterministic decision out.

1. On proposal, the pipeline sends only listing fields (name, merchant, domain, description, metadata, price, recurrence, volume) to Jev with three `noul` questions: prompt injection, crypto exfiltration, price anomaly (compared against typical API plan pricing).
2. Results are cached in `risk_assessments` by `(product_id, content_hash)`.
3. `evaluateGuardrails` compares scores with the delegation's thresholds (defaults: kill 0.9, price deny 0.8, price review 0.5, min trust 95).
4. **Kill switch** (`kill_switch_enabled`, default on): `PROMPT_INJECTION_DETECTED` or `CRYPTO_EXFILTRATION_DETECTED` on a proposed action sets the agent to `suspended` and audits `AGENT_KILL_SWITCH_TRIGGERED`. Every later proposal is denied with `AGENT_SUSPENDED` until the human re-enables it (`AGENT_REENABLED`). The playground loop stops as soon as a tool result reports the kill switch.

The seeded Evil Cloud listing is intentionally adversarial and is exercised by guardrail and production suites. Exact live Jev scores can vary by provider/model version.

Merchant trust comes from the stored `merchants.trust_score` with `trust_score_source` in `scamadvisor | fixture | unavailable`. `refreshMerchantTrust` populates real domains from the live public ScamAdviser page with a 24-hour TTL. Domains in `trusted_domain_overrides` bypass the score check by explicit human choice.

## 14. Failure modes

| Failure | Behaviour | Direction |
| --- | --- | --- |
| Exception inside policy evaluation | Decision = deny | Fail closed |
| No / expired / disabled delegation | `NO_ACTIVE_DELEGATION` deny | Fail closed |
| Empty merchant allowlist | All merchants denied | Fail closed |
| Jev timeout, error, or missing key | `risk = null` ⇒ require human approval | Toward human |
| Merchant has no trust score (`unavailable`; live page check failed or produced no score) | `MERCHANT_TRUST_UNKNOWN` deny, unless the domain is explicitly overridden | Fail closed |
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

## 15. Testing

`pnpm test` runs the Vitest unit and integration suites for policy, guardrails, recipes, groceries, inventory, external purchases, approval hashes, Stripe webhooks, Jev, ScamAdviser parsing, registry/API keys, state transitions, RLS and audit verification. `pnpm typecheck` checks the TypeScript surface.

Hosted suites are separate and require the hosted Supabase/Stripe environment plus network access:

```bash
pnpm exec tsx scripts/e2e/prod-e2e.ts
pnpm exec tsx scripts/e2e/prod-scenarios.ts
pnpm exec tsx scripts/e2e/prod-security.ts
pnpm exec tsx scripts/e2e/prod-mcp-oauth.ts
```

The OAuth production script currently asserts the former five-tool MCP list while the server exposes seven tools; update that assertion before interpreting the suite as green.

## 16. Honest boundaries

- Stripe is test mode only. The provider refuses live secret keys and `livemode: true` responses.
- Only the `purchase` action type is implemented.
- The audit log is tamper-evident, not tamper-proof and not a blockchain. A database superuser could rewrite a complete chain.
- AgentLedger does not claim 100% security.
- Live ScamAdviser HTML and external services can change or fail. Unknown trust fails closed; fictional demo domains use labelled fixture scores.
- External proposals always carry mandatory-human intent, but `allowed_domains` is not currently reconciled with the base merchant-slug allowlist in `proposePurchase`; an eligible site can be denied with `MERCHANT_NOT_ALLOWED`.
- Recipe planning exists and is tested, but is not registered as a concierge tool yet.
- Phone approval is the responsive web approvals page over Realtime, not an SMS workflow.
- Merchant verification proves domain control only; it does not prove fulfillment, product quality, compliance or partnership.

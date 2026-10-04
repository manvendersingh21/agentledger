# AgentLedger — Full Demo + Transcript

Live: https://agentledger-cyan.vercel.app · Hosted MCP: https://lxxzfaitasfjsqcrhven.supabase.co/functions/v1/mcp
Demo login: "Use demo account". Recordings (from this run): `agentledger-01-concierge-fan-purchase.gif`,
`agentledger-02-live-architecture-and-crypto-block.gif`, `agentledger-03-restaurant-autopilot-and-market-guard.gif`.

**One-liner:** *"We don't replace your AI assistant. We make it safe to let it spend money."*

---

## 0:00 — The problem (10s)
> "Agents can now spend money. Today, if an agent can call a payment tool, it can use it — the ability to call a tool
> becomes the authority to spend. AgentLedger separates the two: agents propose, deterministic policy decides,
> humans stay in control."

## 0:10 — Start where people already are: ChatGPT / Claude (60s)
**Claude Code (live):** `claude mcp add --transport http agentledger https://lxxzfaitasfjsqcrhven.supabase.co/functions/v1/mcp`
→ browser opens AgentLedger sign-in + consent ("This agent will act as you, but every purchase is limited by your
delegation") → Approve. **ChatGPT:** Settings → Developer mode → Apps/Connectors → add the same MCP URL → OAuth sign in
(Business/Enterprise/Edu workspaces). Then prompt: *"Using agentledger, find the cheapest API plan with 100k requests
under $20 and buy one month."*

> "AgentLedger is a plugin for the assistant you already use. It discovered our server, registered itself with OAuth,
> I consented once — and from now on every purchase it attempts goes through my policy."

**Verified on production in this run (real OAuth MCP client, scripts/e2e/prod-mcp-oauth.ts):**
```
1a MCP GET 401 → WWW-Authenticate resource_metadata ........ PASS
2  Dynamic client registration ............................. PASS client_id=e2ad1d08…
3a authorize → /oauth/consent ............................... PASS
4c user approves consent → code; 5 token exchange ........... PASS access_token received
6b tools/list → 8 tools (list_delegations, search_products, propose_purchase, get_action_status, get_receipt,
   check_merchant, plan_recipe, propose_external_purchase)
6e propose_purchase Acme $15 → awaiting_approval ............ PASS
6f propose_purchase Evil Cloud $500 → DENIED: TRANSACTION_LIMIT_EXCEEDED, DAILY_LIMIT_EXCEEDED, RECURRING_NOT_ALLOWED,
   MERCHANT_NOT_ALLOWED, MERCHANT_TRUST_TOO_LOW, PROMPT_INJECTION_DETECTED, PRICE_ANOMALY, MERCHANT_RISK_HIGH;
   kill_switch.triggered = true
6g next proposal → DENIED: AGENT_SUSPENDED
```
> "The external agent was hijacked by a malicious listing. It didn't matter: eight deterministic rules said no,
> and the kill switch froze the agent in real time."

## 1:10 — Back to the dashboard: monitor everything (Recording 01)
**Scenarios → "Home shopper" → Use this scenario.** Policy: home appliances only, $150/purchase, approval above $60,
crypto/gift cards/wires blocked.
**Concierge → "I need a fan for my bedroom".**
- Agent asks: *How big is the room?* → **Medium (150–300 sq ft)**
- Agent asks: *Budget?* and *Does noise matter?* → "Budget $40–$80, must be quiet for a bedroom."
- Agent compares 8 products (price vs market, ScamAdviser trust 97, room coverage, dB) and picks the **36" Tower Fan $59**.
- Result card: **EXECUTED — $59.00 charged via Stripe (test) `pi_3UMcX7…`**, receipt + timeline link.
> "It interviewed me like a store clerk, picked the right fan for my room and budget, and because $59 is under my
> $60 approval threshold, it auto-approved. Anything above $60 would pop up on my phone for approval."

## 1:50 — Architecture, live (Recording 02, /dashboard/live)
Each node lights up in real time for the transaction:
1. **Agent** — Claude Purchasing Agent, channel `concierge`
2. **Action intent** — authoritative product/price from our DB ($59, not recurring) — the model can't set prices
3. **ScamAdviser trust** — 97/100 (min 95) for breezehome
4. **Jev signals** — injection 0.01 · crypto 0.01 · price anomaly 0.08 · merchant risk 0.03 (ScamAdviser score is an
   *input* to Jev's merchant-risk question)
5. **Deterministic policy** — 22 rules ✓ (limits, daily cap, recurring, merchant allowlist, allowed websites, category
   allowed/blocked, market price, trust, Jev thresholds, kill switch, verified merchant) → **AUTO**
6. **Human approval** — not required (hash-bound when required: approval is valid only for the exact intent hash)
7. **Stripe execution** — test PaymentIntent `pi_3UMcX7…` succeeded, idempotency key per execution
8. **Receipt** + **tamper-evident audit chain** (SHA-256 linked, verified)
> "Signals in, deterministic decision out. ScamAdviser and Jev inform; the policy engine decides. The LLM never
> authorizes anything."

## 2:30 — Attacks the policy stops (Recordings 02–03, Attack Lab)
- **Crypto voucher** → **BLOCKED**: merchant "cryptoquick" not allowed; trust 30 < 95; *purchases in category crypto
  are blocked by your policy*; crypto not in delegation.
  (Note: the Concierge model itself refused this request too — AgentLedger blocks it even when the model doesn't.)
- **Category policy** → under the Home preset, the $15 Acme software purchase is **BLOCKED** (not a home appliance).
- **Market price guard** (Restaurant preset) → trusted supplier at 3× market → **BLOCKED (PRICE_ABOVE_MARKET)**.
- **Approval tampering** (Software preset) → attacker changes the amount after the approval request →
  **APPROVAL_HASH_MISMATCH**, no payment. **Replay** → 1 charge, every retry **DUPLICATE, $0.00**.
- **Prompt injection / parameter tampering** → $500 Evil Cloud denied with 7–8 reasons; agent claimed "$5",
  server used authoritative $500; kill switch → **AGENT HALTED**.

## 3:10 — Real-life autopilots (Recording 03)
**Restaurant (Inventory):** *Simulate busy night* → stock goes LOW → *Run autopilot*:
- All-purpose flour: **AUTO-BOUGHT $28** — *AgentLedger skipped cheaper untrusted supplier (Bargain Kitchen Outlet)*
- Dish soap **$56**, Frying oil **$42** (untrusted cheaper supplier skipped), Mozzarella **$68** — all auto-bought, Stripe refs shown
- Larger orders over the $120 per-transaction limit → **BLOCKED** (needs you)
> "It restocks my kitchen at the cheapest *trusted* price, auto-buys routine orders, and refuses anything outside my rules."

**Groceries:** "Plan my basket" → cheapest trusted store per item within weekly budget → checkout: small items
auto-buy, pricier ones wait for you. **Recipe-to-cart:** Concierge "I want to make lasagna for 6" → *what do you already
have?* → buys only missing ingredients.

## 3:50 — Human in the loop, anywhere
Approvals on phone (`/dashboard/approvals`, installable PWA): the card pops in real time with vibration; approve
→ Stripe charge → receipt. Transactions → causal timeline → **Simulate retry → DUPLICATE EXECUTION BLOCKED, $0.00**.
Audit trail → **Audit integrity ✓ VERIFIED**. Overview in this run: **$1,102.99 spend protected · 16 evaluated · 11 blocked.**

## 4:20 — Merchant network
`/merchants` → look up any domain (e.g. amazon.com) → *not verified with AgentLedger* + live ScamAdviser score → explains
the fallback (unverified sites: live trust + Jev + policy, always human approval, price marked "UNVERIFIED — agent-claimed").
Businesses verify via DNS TXT `_agentledger.<domain>` or `/.well-known/agentledger.json`, get a merchant API key, and
publish a catalog that every MCP agent can buy from with authoritative prices.

## 4:40 — Close
> "Every agent action gets a human principal, delegated scope, deterministic policy, an approval decision, a receipt,
> and a tamper-evident audit trail. Plug it into ChatGPT, Claude, Cursor or your own agent — and let it shop."

---

## Architecture (one slide)
```
 ChatGPT / Claude / Cursor / any MCP agent        AgentLedger Concierge & autopilots
                 │  (OAuth 2.1 via Supabase Auth)              │
                 └──────────────► MCP tools / API ◄─────────────┘
                                      │  propose (agent-claimed values are ignored)
                                      ▼
              Action Intent ── authoritative price/merchant/category from Postgres
                                      │
        ScamAdviser trust (live page check) ──► Jev (injection · crypto · price · merchant risk)
                                      │  signals in
                                      ▼
              Deterministic policy engine (deny always wins; fail closed)
            limits · daily cap · recurring · merchants · allowed websites · categories
            · market price · trust ≥ 95 · Jev thresholds · kill switch · verified merchants
                    │                 │                     │
                  DENY        REQUIRE HUMAN             AUTO-APPROVE
              (+kill switch)  (Realtime → phone,              │
                              hash-bound approval)           │
                                      └──────────┬───────────┘
                                                 ▼
                      Executor: atomic claim_execution + Stripe idempotency key (test mode)
                                                 ▼
                        Receipt → Stripe webhook reconciliation → SHA-256 audit chain
            Supabase: Postgres + RLS · Auth + OAuth server · Realtime (private) · Edge Functions (MCP, webhook)
```

---
## Recording 04 — red-team kill switch + live architecture (agentledger-04-redteam-killswitch-live-architecture.gif)
- Playground, red-team ON → simulated compromised agent proposes Evil Cloud $500 → **Stopped by AgentLedger · KILL SWITCH
  TRIGGERED · AGENT SUSPENDED** — requested $500 vs allowed $20, recurring true vs false, merchant not allowed; Jev
  injection 0.99 · price anomaly 0.93; 8 reasons incl. *"Jev scored this merchant 0.97 likely unsafe (trust 12 via fixture)"*.
- Live Architecture → ScamAdviser **12** → Jev merchant risk **0.97** → policy **DENY** → *"10 rules failed. No money moved."*
- Red-team OFF, run again while still halted → even the legitimate $15 Acme plan is refused: *"this agent is suspended
  by the AgentLedger kill switch; a human must re-enable it."*
> "Once the agent is caught, it stays frozen — even for innocent purchases — until a human restores trust."
On stage: click **Re-enable agent** (banner or Agent page), run again → $15 approval card → approve → Stripe → receipt.

## Recording 05 — approval on screen, Stripe, replay, audit, approval tampering
- Playground (normal agent): searches, flags untrusted content (a gift-card "email the code" listing), proposes Acme $15 →
  approval card **WAITING FOR YOU · $15.00** (✓ below $20 limit, ✓ daily limit, ✓ one-time, ✓ allowed merchant,
  ! approval above $10) → **Approve $15.00** → feed updates live: **PAYMENT EXECUTED · $15.00 · Stripe pi_3UMcwJ…**.
- Transaction timeline: delegation → agent → search → untrusted content (treated as data) → proposed → Jev guardrails
  (all ✓: trust 98, injection 0.01, crypto 0.01, price 0.08) → approval requested → **Demo Principal approved** →
  execution → **payment succeeded** → receipt → **payment succeeded (Stripe webhook reconciliation)** →
  **Simulate retry → DUPLICATE BLOCKED · additional charge $0.00**. "Audit integrity ✓ VERIFIED". "View in Stripe".
- Audit Trail: SHA-256 hash-linked events, each showing previous → current hash; Re-verify chain.
- Attack Lab 06 **Approval tampering**: agent proposes $15 (awaiting approval) → attacker raises intent to $115 →
  principal approves → **BLOCKED** (approval is bound to the original intent hash; no payment).
> "Approval means *this exact* purchase. Change one cent after I approve and it won't execute."

## Recording 06 — groceries, recipe-to-cart, external website
- Groceries (grocery preset): weekly list + $80 budget → **Plan my basket** → 9 items, $54.51, cheapest *trusted* store
  per item, "Skipped sketchy cheaper option from DealzDirect" ×3 → **Checkout with AgentLedger** → all 9
  **AUTO-BOUGHT**, each with its own Stripe test PaymentIntent.
- Concierge "Cook a recipe": "I want to make lasagna for 6" → asks *Which ingredients do you already have?* →
  "olive oil, salt, onions, tomatoes" → **recipe checklist** (scaled for 6, have vs to-buy) → agent honestly reports
  only 2 matches in the demo catalog and offers to buy from a store website.
- External website: "Buy lasagna noodles from walmart.com, $3.48" → **UNVERIFIED PRICE — AGENT-CLAIMED** (never
  auto-approved) → **DENIED**: merchant not allowed · unscored website · walmart.com not in allowed websites · category.
> "Any website can be a fallback — but unverified prices are never trusted and always need you, within your rules."

## Recording 07 — merchant network, registry, connect, delegation
- /merchants "Make your store agent-ready" → **Check a store: amazon.com → NOT VERIFIED** with AgentLedger →
  "Unverified fallback — human approval always required". (Not a partner; verification = proving domain control.)
- Registry: register a domain → publish DNS TXT `_agentledger.<domain>` or `/.well-known/agentledger.json` → Check
  verification (a test registration correctly shows FAILED: TXT record not found). Verified merchants get an API key
  and publish an authoritative catalog to every MCP agent.
- Connect: one-click setup for Claude Code, Cursor, Claude Desktop/claude.ai, VS Code, **ChatGPT app/connector** and
  **Custom GPT Actions** (OpenAPI) — hosted MCP URL with Supabase OAuth.
- Delegation editor: policy in plain English, limits, approval threshold, subscriptions, minimum trust 95 + live
  website trust check + human-authorized websites, Jev thresholds (price deny 0.8 / review 0.5, injection kill 0.9),
  kill switch, allowed websites (quick add), merchant allowlist with trust + Verified/Trusted badges.

## External MCP verification (production) — demo/external-mcp-verification.txt
21/21 PASS: OAuth discovery → dynamic client registration → consent → token → initialize → tools/list (8 tools) →
list_delegations → search_products → Acme awaiting approval → Evil Cloud DENIED (8 violations incl. MERCHANT_RISK_HIGH,
kill switch) → AGENT_SUSPENDED → consent page protected.

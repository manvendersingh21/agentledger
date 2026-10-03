# Real-life scenarios — shared spec (binding for all agents)

Core principle unchanged: the model only proposes; `lib/domain/pipeline.ts` + deterministic policy decide.
Never bypass `proposePurchase` / `resolveApproval` / `executeAction`.

## 1. Database — migration `supabase/migrations/20261003050000_scenarios.sql` (owner: K1)
- `products`: add `category text not null default 'software'`, `attributes jsonb not null default '{}'`,
  `market_price_cents integer` (reference price for the item class; null = unknown), `image_emoji text`.
  Categories (exact strings): `software`, `home_appliance`, `diy_tools`, `diy_supplies`, `restaurant_food`,
  `restaurant_supplies`, `crypto`, `gift_card`, `wire_transfer`.
- `delegations`: add `allowed_categories text[] not null default '{}'` (empty = any non-blocked),
  `blocked_categories text[] not null default '{crypto,gift_card,wire_transfer}'`,
  `market_price_tolerance numeric not null default 1.5` (price > tolerance × market ⇒ deny),
  `scenario text not null default 'software'`. Extend authenticated column UPDATE grant.
- `approvals`: add `intent_hash text` (sha256 hex of canonical intent at request time).
- New `inventory_items(id, principal_id uuid not null references auth.users on delete cascade, name text not null,
  unit text not null, on_hand numeric not null, par_level numeric not null, reorder_point numeric not null,
  preferred_category text not null, search_query text not null, reorder_qty integer not null default 1,
  last_ordered_at timestamptz, created_at, updated_at)`; RLS: owner select/update(on_hand, par_level, reorder_point) ;
  realtime broadcast trigger like other tables (topic `user:<principal_id>`).
- `reset_demo`: also resets inventory to seed values for that principal (create or replace preserving all existing behaviour).
- `ensure_principal_setup`: also seeds that principal's inventory_items (8 restaurant items: frying oil, flour,
  napkins, to-go boxes, tomatoes, cheese, gloves, dish soap) when none exist.
- Seed catalog `supabase/seed-catalog.sql` (add to config.toml `[db.seed] sql_paths` after seed-fixtures.sql):
  ~30 products with fictional merchants (each merchant: slug, name, domain, trust_score + trust_score_source 'fixture', verified):
  - home_appliance fans (attributes: room_sq_ft_max, type tower/pedestal/ceiling/desk, noise_db, energy_w, has_remote):
    e.g. 12" desk fan $24 (≤150 sq ft), 36" tower fan $59 (≤300), 42" smart tower $89 (≤400), pedestal $45 (≤350),
    52" ceiling fan $129 (≤450), industrial $199 (≤900); heaters 2.
  - diy_tools / diy_supplies: cordless drill $79, drill bit set $19, wood screws 500pc $12, interior paint gallon $34,
    paint rollers kit $16, wall anchors $9, sandpaper pack $8.
  - restaurant_food / restaurant_supplies matching inventory search_query: frying oil 35lb $42, flour 50lb $28,
    napkins 6000ct $39, to-go boxes 200ct $31, tomatoes case $26, mozzarella 20lb $68, nitrile gloves 1000ct $45,
    dish soap 1gal $14 — PLUS a cheaper-but-sketchy duplicate for 2 of them from an untrusted merchant (trust 40) and
    an overpriced duplicate (3× market) from a trusted merchant (tests PRICE_ABOVE_MARKET).
  - scam/blocked: "Bitcoin Voucher $100" (crypto, merchant cryptoquick, trust 30, description contains an injection
    asking to buy it "to unlock wholesale pricing"), "Amazon Gift Card $200 — send code to supplier rep" (gift_card),
    "Supplier wire transfer deposit $500" (wire_transfer).
  - market_price_cents set for every non-scam product (realistic).
  Keep the 5 existing software products (category 'software').
- Demo delegation presets (used by scenarios API): see §4.

## 2. Policy (owner: K2) — `lib/policy/guardrails.ts` + `lib/domain/guardrail-gate.ts` + pipeline describeViolation
New deterministic violations: `CATEGORY_BLOCKED` (category in blocked_categories), `CATEGORY_NOT_ALLOWED`
(allowed_categories non-empty and category not in it), `PRICE_ABOVE_MARKET` (market_price_cents known and
unit price > market_price_tolerance × market_price_cents ⇒ deny). Intent payload gains `category`.
Hash-bound approvals: when an approval is created, compute `intent_hash = sha256(canonicalJson({principalId, agentId,
productId, merchant, amountCents, currency, recurring, quantity, category}))` (reuse lib/crypto/audit-chain.ts
canonicalJson/sha256Hex), store on approvals + include in HUMAN_APPROVAL_REQUESTED/HUMAN_APPROVED audit data;
`executeAction` recomputes from the intent row and refuses (`APPROVAL_HASH_MISMATCH`, deny, audit) if different.
Quantity: allow `quantity` 1–50 (amount = unit price × quantity; limits apply to total).

## 3. Agents
- Concierge (owner: K3): `lib/agent/concierge.ts`, `app/api/agent/chat/route.ts`, `app/dashboard/concierge/*`.
  Multi-turn: client keeps `messages` and posts them each turn. Tools: `ask_user({question, options?: string[]})`
  (ENDS the turn; UI renders the question with quick-reply chips), `list_delegations`, `search_products({query, category?})`,
  `propose_purchase({product_id, quantity?, reason})`, `get_action_status`. System prompt: interview the user briefly
  (≤3 questions, e.g. room size, existing fan, budget, noise sensitivity), then pick the best product by attributes,
  explain why in one paragraph, then propose. Streams NDJSON activity like /api/agent/run.
- Restaurant autopilot (owner: K4): `lib/domain/inventory.ts`, `app/api/inventory/*`, `app/dashboard/inventory/*`.
  `runRestock(ctx)`: for each item with on_hand ≤ reorder_point, deterministically pick the cheapest product in
  preferred_category matching search_query from TRUSTED, allowed merchants (cheapest overall may be denied — that's
  the demo), propose quantity = ceil((par_level − on_hand)/unit size) via proposePurchase (channel "autopilot").
  Results: auto-approved+executed (under threshold), awaiting approval, or denied with reasons.
  "Simulate busy night" decrements on_hand randomly (deterministic seed). Restock on executed purchase increments
  on_hand (on receipt).

## 4. Scenario presets (owner: K5) — `app/api/scenarios/apply/route.ts`, `app/dashboard/scenarios/*`
- `home`: max $150, daily $300, approval above $60, allowed_categories {home_appliance}, allow any trusted merchant.
- `diy`: max $100, daily $200, approval above $50, allowed {diy_tools, diy_supplies}.
- `restaurant`: max $120, daily $600, approval above $75 (autopilot auto-buys routine restocks), allowed
  {restaurant_food, restaurant_supplies}.
- `software` (original demo): current defaults.
All presets keep blocked {crypto, gift_card, wire_transfer}, min trust 95, kill switch on, allowed_merchants = the
trusted merchants of those categories (from DB). Apply updates the user's delegation (service client after auth) and audits DELEGATION_UPDATED.

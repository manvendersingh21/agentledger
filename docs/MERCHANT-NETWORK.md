# Merchant Network — shared spec (binding)

Goal: any business can make its store "agent-ready": check its domain, get verified, publish a catalog, and be
purchasable by any MCP agent (Claude, Cursor, ChatGPT…) through AgentLedger. Unverified websites still work via the
existing fallback checks (live ScamAdviser trust score, Jev signals, delegation policy) — but always with a human.
Never imply a real company (amazon.com, etc.) is a partner/verified unless it actually completed verification.

## DB — migration supabase/migrations/20261003060000_merchant_network.sql (owner M2)
- merchant_api_keys(id, registration_id uuid references merchant_registrations on delete cascade, owner_id uuid,
  key_prefix text not null (first 12 chars, shown), key_hash text not null unique (sha256 hex), created_at, revoked_at)
  RLS: owner select own; insert/revoke via server only.
- products: add `source text not null default 'catalog' check in ('catalog','merchant_feed','external')`,
  `external_url text`, `published_by_registration uuid`.
- merchant_applications(id, company_name, domain, contact_name, contact_email, message, status 'new'|'contacted',
  created_at) — public contact form target; RLS: no public select; insert via server route only.
- action_intents payload may carry `external: true`, `claimed_price_cents`, `source_url` (no schema change).

## Public portal (owner M1): app/merchants/page.tsx (+ client), app/api/merchants/lookup/route.ts, app/api/merchants/apply/route.ts
- /merchants landing (DESIGN.md): "Make your store agent-ready." — explain verification, MCP reach, policy.
- Domain lookup (public, rate-limited in-memory per IP 20/min): returns { domain, agentledger_verified, verified_at,
  scamadviser: {score, source, checkedAt} (live via lib/risk/scamadviser-scrape.ts, cached), would_pass_default_policy
  (score ≥ 95 || verified), how_agents_buy: "verified catalog" | "unverified fallback (human approval required)" }.
- "Get verified" CTA → if signed in: link to /dashboard/registry; contact form → POST /api/merchants/apply (zod, honeypot).

## Merchant feed API (owner M2): lib/registry/api-keys.ts, app/api/merchant/v1/products/route.ts,
   app/api/registry/[id]/keys/route.ts, app/dashboard/registry/registry-client.tsx (add "Publish catalog" section)
- Verified registrations can create an API key (shown once; stored as sha256). POST /api/merchant/v1/products with
  `Authorization: Bearer al_live_merchant_...` upserts up to 100 products {sku, name, description, price_cents,
  currency 'usd', recurring, category, attributes, market_price_cents?} for that registration's merchant
  (source 'merchant_feed'). Unverified/revoked → 401/403. Descriptions remain untrusted content.
- Registry UI: after verification shows key generation, curl example, and the published products list.

## External (unverified website) purchases (owner M3): lib/domain/external.ts, lib/mcp/tools.ts, lib/agent/bind-tools.ts,
   lib/agent/concierge.ts (tool registration only), tests/integration/external.test.ts
- Tool `check_merchant({domain})` → verification status + live trust score + policy preview (no side effects except cache).
- Tool `propose_external_purchase({url, item_name, claimed_price_cents, quantity?, reason})`: domain parsed from https URL;
  SSRF-safe; creates/uses a merchants row (slug from domain, trusted=false, verified=false, trust via live scrape) and a
  products row (source 'external', price = claimed price, market_price_cents null) then calls proposePurchase.
  Policy additions (in guardrail-gate, deterministic): external/unverified purchases ALWAYS require human approval
  (never auto-approve) and are labelled "UNVERIFIED PRICE — agent-claimed"; still subject to all deny rules
  (trust ≥ min unless domain in trusted_domain_overrides/allowed_domains, categories, limits, kill switch).
  Merchant allowlist rule: external domains pass the merchant rule only if domain ∈ allowed_domains or trusted_domain_overrides.
- Verified merchant feed products behave like catalog products (authoritative price from merchant feed).

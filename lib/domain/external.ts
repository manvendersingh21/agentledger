// External (unverified website) purchases — Merchant Network spec, External section.
//
// `check_merchant`: verification status + live ScamAdviser trust score + policy preview. No side
// effects other than the trust-score cache on the merchants row.
// `propose_external_purchase`: SSRF-safe URL parsing (the user-supplied URL is NEVER fetched; only
// ScamAdviser's public check page is fetched for the bare domain), creates/uses an unverified
// merchants row + an `external` products row priced at the agent-CLAIMED amount, then runs the
// normal deterministic pipeline via proposePurchase. External purchases are never auto-approved:
// the guardrail gate forces require_approval (EXTERNAL_REQUIRES_HUMAN) and labels the price
// "UNVERIFIED PRICE — agent-claimed".
//
// Runtime-agnostic (Next.js server + Supabase Edge/Deno MCP): relative `.ts` imports, no Node built-ins.
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { proposePurchase, type DomainContext, type ProposeResult } from "./pipeline.ts";
import { formatUsd } from "./products.ts";
import { UNVERIFIED_PRICE_LABEL } from "../policy/guardrails.ts";
import {
  isValidTrustDomain,
  normalizeTrustDomain,
  scrapeScamAdviser,
} from "../risk/scamadviser-scrape.ts";
import { refreshMerchantTrust } from "../risk/trust-refresh.ts";
import type { TrustScore } from "../risk/scamadvisor.ts";

/** Default delegation minimum trust score (matches delegations.min_trust_score default). */
export const DEFAULT_MIN_TRUST_SCORE = 95;

// ---------------------------------------------------------------------------------------------
// Inputs

export const CheckMerchantInput = z.object({
  domain: z
    .string()
    .trim()
    .min(1)
    .max(500)
    .describe('Website domain or URL to check, e.g. "shop.example.com" or "https://shop.example.com/item"'),
});
export type CheckMerchantInput = z.input<typeof CheckMerchantInput>;

export const ProposeExternalPurchaseInput = z.object({
  url: z
    .string()
    .trim()
    .min(12)
    .max(2000)
    .describe("Full https:// product page URL on the external website the user named"),
  item_name: z.string().trim().min(1).max(200).describe("Item name exactly as shown on the website"),
  claimed_price_cents: z
    .number()
    .int()
    .min(1)
    .max(10_000_000)
    .describe("Price in USD cents as seen on the website. Agent-claimed and UNVERIFIED; a human must confirm it."),
  quantity: z.number().int().min(1).max(50).optional().describe("Quantity (default 1)"),
  reason: z.string().max(1000).optional().describe("Why this external purchase is needed; recorded in the audit log"),
});
export type ProposeExternalPurchaseInput = z.input<typeof ProposeExternalPurchaseInput>;

// ---------------------------------------------------------------------------------------------
// URL / domain handling (SSRF-safe: we never fetch the supplied URL)

export type ParsedExternalUrl =
  | { ok: true; url: string; domain: string }
  | { ok: false; reason: string };

export function parseExternalUrl(raw: string): ParsedExternalUrl {
  let parsed: URL;
  try {
    parsed = new URL(raw.trim());
  } catch {
    return { ok: false, reason: "The URL could not be parsed." };
  }
  if (parsed.protocol !== "https:") {
    return { ok: false, reason: "Only https:// URLs are accepted." };
  }
  if (parsed.username !== "" || parsed.password !== "") {
    return { ok: false, reason: "URLs with embedded credentials are not accepted." };
  }
  const domain = normalizeTrustDomain(parsed.hostname);
  if (!isValidTrustDomain(domain)) {
    return {
      ok: false,
      reason: "The URL host must be a public domain name (IP addresses and localhost are not accepted).",
    };
  }
  return { ok: true, url: parsed.toString(), domain };
}

// ---------------------------------------------------------------------------------------------
// check_merchant

export type CheckMerchantResult =
  | { status: "invalid_domain"; domain: string; message: string }
  | {
      status: "ok";
      domain: string;
      agentledger_verified: boolean;
      verified_at: string | null;
      merchant: { slug: string; name: string; trusted: boolean } | null;
      scamadviser: { score: number | null; source: string; checkedAt: string };
      would_pass_default_policy: boolean;
      how_agents_buy: "verified catalog" | "unverified fallback (human approval required)";
      note: string;
    };

interface MerchantLookupRow {
  id: string;
  slug: string;
  name: string;
  trusted: boolean | null;
  verified: boolean | null;
  verified_at: string | null;
}

export async function checkMerchant(
  ctx: Pick<DomainContext, "db">,
  rawInput: unknown,
): Promise<CheckMerchantResult> {
  const parsed = CheckMerchantInput.safeParse(rawInput);
  if (!parsed.success) {
    return { status: "invalid_domain", domain: "", message: "A domain (or https URL) is required." };
  }
  const domain = normalizeTrustDomain(parsed.data.domain);
  if (!isValidTrustDomain(domain)) {
    return {
      status: "invalid_domain",
      domain,
      message: "Not a valid public website domain (IP addresses and localhost are not accepted).",
    };
  }

  const { data: merchantData } = await ctx.db
    .from("merchants")
    .select("id, slug, name, trusted, verified, verified_at")
    .eq("domain", domain)
    .maybeSingle();
  const merchantRow = (merchantData as MerchantLookupRow | null) ?? null;

  let verified = false;
  let verifiedAt: string | null = null;
  let trust: TrustScore;

  if (merchantRow) {
    verified = merchantRow.verified === true;
    verifiedAt = merchantRow.verified_at ?? null;
    trust = await refreshMerchantTrust(ctx.db, { merchantId: merchantRow.id });
  } else {
    // A verified registration without a merchants row should not happen, but check anyway.
    const { data: registration } = await ctx.db
      .from("merchant_registrations")
      .select("verified_at")
      .eq("domain", domain)
      .eq("status", "verified")
      .maybeSingle();
    if (registration) {
      verified = true;
      verifiedAt = registration.verified_at ? String(registration.verified_at) : null;
    }
    const live = await scrapeScamAdviser(domain);
    trust = { domain, score: live.score, source: live.source, checkedAt: live.checkedAt };
  }

  const wouldPass = verified || (trust.score !== null && trust.score >= DEFAULT_MIN_TRUST_SCORE);
  return {
    status: "ok",
    domain,
    agentledger_verified: verified,
    verified_at: verifiedAt,
    merchant: merchantRow
      ? { slug: merchantRow.slug, name: merchantRow.name, trusted: merchantRow.trusted === true }
      : null,
    scamadviser: { score: trust.score, source: trust.source, checkedAt: trust.checkedAt },
    would_pass_default_policy: wouldPass,
    how_agents_buy: verified ? "verified catalog" : "unverified fallback (human approval required)",
    note: verified
      ? "This merchant completed AgentLedger verification: agents buy from its published catalog with authoritative prices."
      : "This website is NOT verified with AgentLedger. Purchases use the unverified fallback: the price is agent-claimed and a human must always approve the purchase.",
  };
}

// ---------------------------------------------------------------------------------------------
// propose_external_purchase

export interface ExternalPurchaseContext {
  domain: string;
  source_url: string;
  merchant_slug: string;
  agentledger_verified: false;
  trust: { score: number | null; source: string; checkedAt: string };
  claimed_price_cents: number;
  price_label: typeof UNVERIFIED_PRICE_LABEL;
  requires_human: true;
  note: string;
}

export type ProposeExternalResult = ProposeResult & { external?: ExternalPurchaseContext };

interface ExternalMerchantRow {
  id: string;
  slug: string;
  verified: boolean | null;
}

function domainToSlug(domain: string): string {
  return domain.replace(/\./g, "-");
}

const MERCHANT_COLUMNS = "id, slug, verified";

async function ensureExternalMerchant(db: SupabaseClient, domain: string): Promise<ExternalMerchantRow> {
  const { data: existing, error: lookupError } = await db
    .from("merchants")
    .select(MERCHANT_COLUMNS)
    .eq("domain", domain)
    .maybeSingle();
  if (lookupError) throw new Error(`merchant lookup failed: ${lookupError.message}`);
  if (existing) return existing as ExternalMerchantRow;

  const insertMerchant = async (slug: string) =>
    db
      .from("merchants")
      .insert({
        slug,
        name: domain,
        domain,
        trusted: false,
        verified: false,
        trust_score_source: "unavailable",
      })
      .select(MERCHANT_COLUMNS)
      .single();

  const slug = domainToSlug(domain);
  const { data: inserted, error: insertError } = await insertMerchant(slug);
  if (!insertError && inserted) return inserted as ExternalMerchantRow;
  if (insertError && insertError.code !== "23505") {
    throw new Error(`merchant insert failed: ${insertError.message}`);
  }

  // Unique conflict: either the domain row was created concurrently, or the slug is taken.
  const { data: byDomain } = await db.from("merchants").select(MERCHANT_COLUMNS).eq("domain", domain).maybeSingle();
  if (byDomain) return byDomain as ExternalMerchantRow;
  const suffixed = `${slug}-${crypto.randomUUID().slice(0, 8)}`;
  const { data: retried, error: retryError } = await insertMerchant(suffixed);
  if (retryError || !retried) throw new Error(`merchant insert failed: ${retryError?.message ?? "unknown"}`);
  return retried as ExternalMerchantRow;
}

async function ensureExternalProduct(
  db: SupabaseClient,
  merchantId: string,
  url: string,
  input: { item_name: string; claimed_price_cents: number },
): Promise<string> {
  const { data: existing, error: lookupError } = await db
    .from("products")
    .select("id")
    .eq("merchant_id", merchantId)
    .eq("source", "external")
    .eq("external_url", url)
    .eq("name", input.item_name)
    .eq("price_cents", input.claimed_price_cents)
    .eq("active", true)
    .order("created_at", { ascending: false })
    .limit(1);
  if (lookupError) throw new Error(`external product lookup failed: ${lookupError.message}`);
  const hit = existing?.[0] as { id: string } | undefined;
  if (hit) return hit.id;

  const { data: inserted, error: insertError } = await db
    .from("products")
    .insert({
      merchant_id: merchantId,
      name: input.item_name,
      description:
        `${UNVERIFIED_PRICE_LABEL}. External item proposed by an agent from ${url}. ` +
        `The ${formatUsd(input.claimed_price_cents)} price is agent-claimed and NOT verified by AgentLedger; ` +
        "a human must approve any purchase of it.",
      price_cents: input.claimed_price_cents,
      currency: "usd",
      recurring: false,
      metadata: { external: true, source_url: url, claimed_price_cents: input.claimed_price_cents },
      active: true,
      source: "external",
      external_url: url,
      market_price_cents: null,
    })
    .select("id")
    .single();
  if (insertError || !inserted) throw new Error(`external product insert failed: ${insertError?.message ?? "unknown"}`);
  return (inserted as { id: string }).id;
}

/**
 * Propose buying an item from an external (unverified) website. Runs the full deterministic
 * pipeline; if every deny rule passes, the result is ALWAYS awaiting_approval, never executed.
 */
export async function proposeExternalPurchase(
  ctx: DomainContext,
  rawInput: unknown,
): Promise<ProposeExternalResult> {
  const parsed = ProposeExternalPurchaseInput.safeParse(rawInput);
  if (!parsed.success) {
    return {
      status: "rejected",
      error: "INVALID_INPUT",
      message: `Invalid external purchase proposal: ${parsed.error.issues.map((i) => i.message).join("; ")}`,
    };
  }
  const input = parsed.data;

  const parsedUrl = parseExternalUrl(input.url);
  if (!parsedUrl.ok) {
    return { status: "rejected", error: "INVALID_URL", message: `${parsedUrl.reason} No action was created.` };
  }

  let merchant: ExternalMerchantRow;
  try {
    merchant = await ensureExternalMerchant(ctx.db, parsedUrl.domain);
  } catch (error) {
    console.error(
      JSON.stringify({ scope: "agentledger:external", message: "merchant create/load failed", domain: parsedUrl.domain, error: String(error) }),
    );
    return {
      status: "rejected",
      error: "EXTERNAL_MERCHANT_UNAVAILABLE",
      message: "Could not create or load a merchant record for this website. No action was created.",
    };
  }

  if (merchant.verified === true) {
    return {
      status: "rejected",
      error: "MERCHANT_VERIFIED",
      message: `${parsedUrl.domain} is a verified AgentLedger merchant. Use search_products and propose_purchase with its catalog products (authoritative prices) instead of an external purchase.`,
    };
  }

  // Live trust score (cached with a 24h TTL on the merchants row). Failure ⇒ score null ⇒ the
  // deterministic trust rule fails closed (MERCHANT_TRUST_UNKNOWN) unless the human allowed the domain.
  let trust: TrustScore;
  try {
    trust = await refreshMerchantTrust(ctx.db, { merchantId: merchant.id });
  } catch {
    trust = { domain: parsedUrl.domain, score: null, source: "unavailable", checkedAt: new Date().toISOString() };
  }

  let productId: string;
  try {
    productId = await ensureExternalProduct(ctx.db, merchant.id, parsedUrl.url, input);
  } catch (error) {
    console.error(
      JSON.stringify({ scope: "agentledger:external", message: "external product create failed", domain: parsedUrl.domain, error: String(error) }),
    );
    return {
      status: "rejected",
      error: "EXTERNAL_PRODUCT_UNAVAILABLE",
      message: "Could not record the external item. No action was created.",
    };
  }

  const result = await proposePurchase(ctx, {
    product_id: productId,
    quantity: input.quantity ?? 1,
    reason: input.reason ?? `External purchase from ${parsedUrl.domain} (agent-claimed price)`,
  });

  const external: ExternalPurchaseContext = {
    domain: parsedUrl.domain,
    source_url: parsedUrl.url,
    merchant_slug: merchant.slug,
    agentledger_verified: false,
    trust: { score: trust.score, source: trust.source, checkedAt: trust.checkedAt },
    claimed_price_cents: input.claimed_price_cents,
    price_label: UNVERIFIED_PRICE_LABEL,
    requires_human: true,
    note: "Unverified website: this purchase is never auto-approved. If policy passes, it waits for human approval.",
  };
  return { ...result, external };
}

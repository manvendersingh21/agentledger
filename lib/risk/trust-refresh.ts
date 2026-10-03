import type { SupabaseClient } from "@supabase/supabase-js";
import {
  scrapeScamAdviser,
  type ScamAdviserScrapeResult,
} from "./scamadviser-scrape.ts";
import type { TrustScore } from "./scamadvisor.ts";

export const TRUST_SCORE_TTL_MS = 24 * 60 * 60 * 1000;

type MerchantTrustRow = {
  id: string;
  domain: string | null;
  trust_score: number | string | null;
  trust_score_source: string;
  trust_scored_at: string | null;
};

const inFlightByDomain = new Map<string, Promise<ScamAdviserScrapeResult>>();

function isFresh(scoredAt: string | null, now = Date.now()): boolean {
  if (!scoredAt) return false;
  const ts = new Date(scoredAt).getTime();
  if (!Number.isFinite(ts)) return false;
  return now - ts < TRUST_SCORE_TTL_MS;
}

function rowToTrustScore(row: MerchantTrustRow): TrustScore {
  const domain = row.domain?.trim().toLowerCase() ?? "";
  const score =
    row.trust_score === null || row.trust_score === undefined
      ? null
      : Number(row.trust_score);
  const source = row.trust_score_source as TrustScore["source"];
  return {
    domain,
    score: Number.isFinite(score) ? score : null,
    source:
      source === "scamadvisor" || source === "fixture" || source === "unavailable"
        ? source
        : "unavailable",
    checkedAt: row.trust_scored_at ?? new Date().toISOString(),
  };
}

async function fetchLiveSerialized(domain: string): Promise<ScamAdviserScrapeResult> {
  const existing = inFlightByDomain.get(domain);
  if (existing) return existing;

  const promise = scrapeScamAdviser(domain).finally(() => {
    if (inFlightByDomain.get(domain) === promise) {
      inFlightByDomain.delete(domain);
    }
  });
  inFlightByDomain.set(domain, promise);
  return promise;
}

async function loadMerchantById(
  db: SupabaseClient,
  merchantId: string,
): Promise<MerchantTrustRow | null> {
  const { data, error } = await db
    .from("merchants")
    .select("id, domain, trust_score, trust_score_source, trust_scored_at")
    .eq("id", merchantId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data as MerchantTrustRow | null;
}

async function loadMerchantByDomain(
  db: SupabaseClient,
  domain: string,
): Promise<MerchantTrustRow | null> {
  const { data, error } = await db
    .from("merchants")
    .select("id, domain, trust_score, trust_score_source, trust_scored_at")
    .eq("domain", domain)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data as MerchantTrustRow | null;
}

async function persistTrust(
  db: SupabaseClient,
  merchantId: string,
  live: ScamAdviserScrapeResult,
): Promise<TrustScore> {
  const trustScoreSource = live.source === "scamadvisor" ? "scamadvisor" : "unavailable";
  const { data, error } = await db
    .from("merchants")
    .update({
      trust_score: live.score,
      trust_score_source: trustScoreSource,
      trust_scored_at: live.checkedAt,
    })
    .eq("id", merchantId)
    .select("id, domain, trust_score, trust_score_source, trust_scored_at")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) {
    return {
      domain: live.domain,
      score: live.score,
      source: trustScoreSource,
      checkedAt: live.checkedAt,
    };
  }
  return rowToTrustScore(data as MerchantTrustRow);
}

export type RefreshMerchantTrustTarget =
  | { merchantId: string }
  | { domain: string };

export interface RefreshMerchantTrustOptions {
  force?: boolean;
}

/**
 * Refresh stored merchant trust from ScamAdviser's public check-website page.
 * Respects 24h TTL, serializes live fetches per domain, and never overwrites fixture rows unless force.
 */
export async function refreshMerchantTrust(
  db: SupabaseClient,
  target: RefreshMerchantTrustTarget,
  options: RefreshMerchantTrustOptions = {},
): Promise<TrustScore> {
  const force = options.force === true;
  const row =
    "merchantId" in target
      ? await loadMerchantById(db, target.merchantId)
      : await loadMerchantByDomain(db, target.domain.trim().toLowerCase());

  if (!row) {
    const domain = "domain" in target ? target.domain.trim().toLowerCase() : "";
    return {
      domain,
      score: null,
      source: "unavailable",
      checkedAt: new Date().toISOString(),
    };
  }

  if (row.trust_score_source === "fixture" && !force) {
    return rowToTrustScore(row);
  }

  const domain = row.domain?.trim().toLowerCase() ?? "";
  if (!domain) {
    return rowToTrustScore(row);
  }

  if (!force && isFresh(row.trust_scored_at)) {
    return rowToTrustScore(row);
  }

  const live = await fetchLiveSerialized(domain);
  return persistTrust(db, row.id, live);
}

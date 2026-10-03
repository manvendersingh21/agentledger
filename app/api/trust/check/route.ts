import { NextResponse } from "next/server";
import { z } from "zod";
import { getPrincipal } from "@/lib/auth/session";
import { errorResponse, unauthorized } from "@/lib/domain/http";
import {
  isValidTrustDomain,
  normalizeTrustDomain,
  scrapeScamAdviser,
  type ScamAdviserScrapeResult,
} from "@/lib/risk/scamadviser-scrape";
import { TRUST_SCORE_TTL_MS } from "@/lib/risk/trust-refresh";

const Body = z.object({
  domain: z.string().min(1).max(253),
});

type CacheEntry = { result: ScamAdviserScrapeResult; expiresAt: number };

const liveCache = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<ScamAdviserScrapeResult>>();

function cacheGet(domain: string): ScamAdviserScrapeResult | null {
  const entry = liveCache.get(domain);
  if (!entry) return null;
  if (Date.now() >= entry.expiresAt) {
    liveCache.delete(domain);
    return null;
  }
  return entry.result;
}

function cacheSet(result: ScamAdviserScrapeResult): void {
  liveCache.set(result.domain, {
    result,
    expiresAt: Date.now() + TRUST_SCORE_TTL_MS,
  });
}

async function getLiveTrustScore(domain: string): Promise<ScamAdviserScrapeResult> {
  const cached = cacheGet(domain);
  if (cached) return cached;

  const pending = inFlight.get(domain);
  if (pending) return pending;

  const promise = scrapeScamAdviser(domain)
    .then((result) => {
      cacheSet(result);
      return result;
    })
    .finally(() => {
      if (inFlight.get(domain) === promise) {
        inFlight.delete(domain);
      }
    });

  inFlight.set(domain, promise);
  return promise;
}

/** Live ScamAdviser trust check for signed-in users (24h in-process cache per domain). */
export async function POST(request: Request) {
  try {
    const principal = await getPrincipal();
    if (!principal) return unauthorized();

    const { domain: raw } = Body.parse(await request.json());
    const domain = normalizeTrustDomain(raw);
    if (!isValidTrustDomain(domain)) {
      return NextResponse.json(
        { error: "INVALID_DOMAIN", message: "Enter a valid public hostname (no IPs or localhost)." },
        { status: 400 },
      );
    }

    const trust = await getLiveTrustScore(domain);
    return NextResponse.json({ trust });
  } catch (error) {
    return errorResponse(error);
  }
}

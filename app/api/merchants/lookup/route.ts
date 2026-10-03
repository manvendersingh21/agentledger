import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { errorResponse } from "@/lib/domain/http";
import { getPublicVerifiedByDomain } from "@/lib/registry/registry";
import {
  isValidTrustDomain,
  normalizeTrustDomain,
  scrapeScamAdviser,
  type ScamAdviserScrapeResult,
} from "@/lib/risk/scamadviser-scrape";
import { TRUST_SCORE_TTL_MS } from "@/lib/risk/trust-refresh";

export const runtime = "nodejs";

const RATE_LIMIT = 20;
const RATE_WINDOW_MS = 60_000;

const Domain = z
  .string()
  .trim()
  .min(1, "Enter a domain to check.")
  .max(253, "Domain is too long.")
  .transform(normalizeTrustDomain)
  .refine(isValidTrustDomain, {
    message: "Enter a valid public hostname (no IPs or localhost).",
  });

type RateEntry = {
  count: number;
  resetAt: number;
};

type CacheEntry = {
  result: ScamAdviserScrapeResult;
  expiresAt: number;
};

const requestsByIp = new Map<string, RateEntry>();
const trustByDomain = new Map<string, CacheEntry>();
const trustInFlight = new Map<string, Promise<ScamAdviserScrapeResult>>();

function requestIp(request: NextRequest): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || request.headers.get("x-real-ip")?.trim() || "unknown";
}

function takeRateLimit(ip: string): {
  allowed: boolean;
  remaining: number;
  resetAt: number;
} {
  const now = Date.now();
  const current = requestsByIp.get(ip);
  if (!current || now >= current.resetAt) {
    const resetAt = now + RATE_WINDOW_MS;
    requestsByIp.set(ip, { count: 1, resetAt });
    return { allowed: true, remaining: RATE_LIMIT - 1, resetAt };
  }

  if (current.count >= RATE_LIMIT) {
    return { allowed: false, remaining: 0, resetAt: current.resetAt };
  }

  current.count += 1;
  return {
    allowed: true,
    remaining: RATE_LIMIT - current.count,
    resetAt: current.resetAt,
  };
}

function rateHeaders(rate: { remaining: number; resetAt: number }): HeadersInit {
  return {
    "Cache-Control": "no-store",
    "RateLimit-Limit": String(RATE_LIMIT),
    "RateLimit-Remaining": String(rate.remaining),
    "RateLimit-Reset": String(Math.ceil(rate.resetAt / 1000)),
  };
}

function cachedTrust(domain: string): ScamAdviserScrapeResult | null {
  const entry = trustByDomain.get(domain);
  if (!entry) return null;
  if (Date.now() >= entry.expiresAt) {
    trustByDomain.delete(domain);
    return null;
  }
  return entry.result;
}

async function liveTrust(domain: string): Promise<ScamAdviserScrapeResult> {
  const cached = cachedTrust(domain);
  if (cached) return cached;

  const existing = trustInFlight.get(domain);
  if (existing) return existing;

  const pending = scrapeScamAdviser(domain)
    .then((result) => {
      trustByDomain.set(domain, {
        result,
        expiresAt: Date.now() + TRUST_SCORE_TTL_MS,
      });
      return result;
    })
    .finally(() => {
      if (trustInFlight.get(domain) === pending) {
        trustInFlight.delete(domain);
      }
    });

  trustInFlight.set(domain, pending);
  return pending;
}

export async function GET(request: NextRequest) {
  const rate = takeRateLimit(requestIp(request));
  const headers = rateHeaders(rate);

  if (!rate.allowed) {
    const retryAfter = Math.max(1, Math.ceil((rate.resetAt - Date.now()) / 1000));
    return NextResponse.json(
      {
        error: "RATE_LIMITED",
        message: "Too many lookups. Please try again in a minute.",
      },
      {
        status: 429,
        headers: { ...headers, "Retry-After": String(retryAfter) },
      },
    );
  }

  try {
    const domain = Domain.parse(request.nextUrl.searchParams.get("domain") ?? "");
    const [registration, scamadviser] = await Promise.all([
      getPublicVerifiedByDomain(domain),
      liveTrust(domain),
    ]);
    const verified = registration.verified;
    const wouldPassDefaultPolicy =
      verified || (scamadviser.score !== null && scamadviser.score >= 95);

    return NextResponse.json(
      {
        domain,
        agentledger_verified: verified,
        verified_at: registration.verifiedAt,
        scamadviser: {
          score: scamadviser.score,
          source: scamadviser.source,
          checkedAt: scamadviser.checkedAt,
        },
        would_pass_default_policy: wouldPassDefaultPolicy,
        how_agents_buy: verified
          ? "verified catalog"
          : "unverified fallback (human approval required)",
      },
      { headers },
    );
  } catch (error) {
    const response = errorResponse(error, { route: "merchant_lookup" });
    for (const [name, value] of Object.entries(headers)) {
      response.headers.set(name, value);
    }
    return response;
  }
}

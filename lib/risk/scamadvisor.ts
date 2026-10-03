import { z } from "zod";

export interface TrustScore {
  domain: string;
  score: number | null;
  source: "scamadvisor" | "fixture" | "unavailable";
  checkedAt: string;
}

export interface TrustScoreProvider {
  score(domain: string): Promise<TrustScore>;
}

const DEFAULT_SCAMADVISOR_API_URL = "https://api.scamadviser.com/v2/trust";

const scamadviserResponseSchema = z
  .object({
    trustscore: z.number().optional(),
    trust_score: z.number().optional(),
    score: z.number().optional(),
    domain: z.string().optional(),
  })
  .passthrough();

function normalizeScore(value: number): number {
  if (!Number.isFinite(value)) {
    return NaN;
  }
  if (value >= 0 && value <= 1) {
    return Math.round(value * 100);
  }
  return Math.round(value);
}

function unavailable(domain: string): TrustScore {
  return {
    domain,
    score: null,
    source: "unavailable",
    checkedAt: new Date().toISOString(),
  };
}

export interface ScamAdvisorProviderOptions {
  apiKey?: string;
  apiUrl?: string;
  fetchImpl?: typeof fetch;
}

export class ScamAdvisorProvider implements TrustScoreProvider {
  private readonly apiKey: string | undefined;
  private readonly apiUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: ScamAdvisorProviderOptions = {}) {
    this.apiKey = options.apiKey ?? process.env.SCAMADVISOR_API_KEY;
    this.apiUrl = options.apiUrl ?? process.env.SCAMADVISOR_API_URL ?? DEFAULT_SCAMADVISOR_API_URL;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async score(domain: string): Promise<TrustScore> {
    const normalizedDomain = domain.trim().toLowerCase();
    if (!normalizedDomain || !this.apiKey) {
      return unavailable(normalizedDomain || domain);
    }

    try {
      const url = new URL(this.apiUrl);
      url.searchParams.set("domain", normalizedDomain);
      url.searchParams.set("apikey", this.apiKey);

      const response = await this.fetchImpl(url.toString(), {
        method: "GET",
        headers: { Accept: "application/json" },
      });

      if (!response.ok) {
        return unavailable(normalizedDomain);
      }

      const raw: unknown = await response.json();
      const parsed = scamadviserResponseSchema.safeParse(raw);
      if (!parsed.success) {
        return unavailable(normalizedDomain);
      }

      const candidate =
        parsed.data.trustscore ?? parsed.data.trust_score ?? parsed.data.score;
      if (candidate === undefined) {
        return unavailable(normalizedDomain);
      }

      const score = normalizeScore(candidate);
      if (!Number.isFinite(score) || score < 0 || score > 100) {
        return unavailable(normalizedDomain);
      }

      return {
        domain: normalizedDomain,
        score,
        source: "scamadvisor",
        checkedAt: new Date().toISOString(),
      };
    } catch {
      return unavailable(normalizedDomain);
    }
  }
}

export class FixtureTrustProvider implements TrustScoreProvider {
  constructor(private readonly fixtures: Record<string, number>) {}

  async score(domain: string): Promise<TrustScore> {
    const normalizedDomain = domain.trim().toLowerCase();
    const stored = this.fixtures[normalizedDomain];
    if (stored === undefined) {
      return unavailable(normalizedDomain || domain);
    }

    return {
      domain: normalizedDomain,
      score: stored,
      source: "fixture",
      checkedAt: new Date().toISOString(),
    };
  }
}

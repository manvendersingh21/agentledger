const SCAMADVISER_CHECK_BASE = "https://www.scamadviser.com/check-website/";
export const SCAMADVISER_USER_AGENT =
  "AgentLedger trust check (+https://github.com/agentledger)";

const HOSTNAME_LABEL =
  /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/i;
const IPV4 = /^(?:\d{1,3}\.){3}\d{1,3}$/;
const IPV6 = /:/;

export interface ScamAdviserScrapeResult {
  domain: string;
  score: number | null;
  source: "scamadvisor" | "unavailable";
  checkedAt: string;
}

export interface ScrapeScamAdviserOptions {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

function unavailable(domain: string): ScamAdviserScrapeResult {
  return {
    domain,
    score: null,
    source: "unavailable",
    checkedAt: new Date().toISOString(),
  };
}

/** Strip URL noise; returns lowercase hostname or empty string if invalid. */
export function normalizeTrustDomain(raw: string): string {
  let value = raw.trim().toLowerCase();
  if (!value) return "";

  if (value.includes("://")) {
    try {
      value = new URL(value).hostname.toLowerCase();
    } catch {
      return "";
    }
  } else {
    const slash = value.indexOf("/");
    if (slash >= 0) value = value.slice(0, slash);
    const colon = value.indexOf(":");
    if (colon >= 0) value = value.slice(0, colon);
  }

  if (value.startsWith("www.")) {
    value = value.slice(4);
  }

  return value;
}

export function isValidTrustDomain(domain: string): boolean {
  const host = normalizeTrustDomain(domain);
  if (!host || host.length > 253) return false;
  if (host === "localhost" || host.endsWith(".localhost")) return false;
  if (IPV4.test(host) || IPV6.test(host)) return false;
  return HOSTNAME_LABEL.test(host);
}

export function unescapeHtmlEntities(html: string): string {
  return html
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#x27;/gi, "'")
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)));
}

/** Parse ScamAdviser check-website HTML (Inertia data-page JSON). */
export function parseRatingScoreFromPage(html: string): number | null {
  const text = unescapeHtmlEntities(html);
  const match = text.match(/"ratingScore"\s*:\s*(\d+(?:\.\d+)?)/);
  if (!match) return null;
  const score = Number(match[1]);
  if (!Number.isFinite(score) || score < 0 || score > 100) return null;
  return Math.round(score);
}

export async function scrapeScamAdviser(
  domain: string,
  options: ScrapeScamAdviserOptions = {},
): Promise<ScamAdviserScrapeResult> {
  const normalized = normalizeTrustDomain(domain);
  if (!isValidTrustDomain(normalized)) {
    return unavailable(normalized || domain.trim().toLowerCase());
  }

  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 10_000;
  const url = `${SCAMADVISER_CHECK_BASE}${encodeURIComponent(normalized)}`;

  try {
    const response = await fetchImpl(url, {
      method: "GET",
      headers: {
        Accept: "text/html",
        "User-Agent": SCAMADVISER_USER_AGENT,
      },
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!response.ok) {
      return unavailable(normalized);
    }

    const html = await response.text();
    const score = parseRatingScoreFromPage(html);
    if (score === null) {
      return unavailable(normalized);
    }

    return {
      domain: normalized,
      score,
      source: "scamadvisor",
      checkedAt: new Date().toISOString(),
    };
  } catch {
    return unavailable(normalized);
  }
}

const SCAMADVISER_CHECK_BASE = "https://www.scamadviser.com/check-website/";
// robots.txt: only /check-website/ pages may be fetched; redirects are followed only when they stay there.
const SCAMADVISER_ALLOWED_PATH = "/check-website/";
const MAX_REDIRECTS = 3;
const DEFAULT_TIMEOUT_MS = 12_000;
export const SCAMADVISER_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36";
const SCAMADVISER_HEADERS = {
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "User-Agent": SCAMADVISER_USER_AGENT,
};

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

// Matches `"ratingScore":85`, `"ratingScore":"85"` and the backslash-escaped form found when the
// JSON is embedded inside a JS string (`\"ratingScore\":85`).
const RATING_SCORE = /\\?"ratingScore\\?"\s*:\s*\\?"?(\d+(?:\.\d+)?)/;

/** Parse ScamAdviser check-website HTML (Inertia data-page JSON, HTML-escaped or plain). */
export function parseRatingScoreFromPage(html: string): number | null {
  const match = html.match(RATING_SCORE) ?? unescapeHtmlEntities(html).match(RATING_SCORE);
  if (!match) return null;
  const score = Number(match[1]);
  if (!Number.isFinite(score) || score < 0 || score > 100) return null;
  return Math.round(score);
}

/** Resolve a redirect target; only https scamadviser.com /check-website/ pages are allowed. */
function allowedRedirectTarget(location: string, base: string): string | null {
  let target: URL;
  try {
    target = new URL(location, base);
  } catch {
    return null;
  }
  const host = target.hostname.toLowerCase();
  if (target.protocol !== "https:") return null;
  if (host !== "scamadviser.com" && !host.endsWith(".scamadviser.com")) return null;
  if (!target.pathname.startsWith(SCAMADVISER_ALLOWED_PATH)) return null;
  return target.toString();
}

function logFailure(domain: string, reason: string, status?: number): void {
  console.warn(
    JSON.stringify({ scope: "agentledger:scamadviser", message: "live trust score unavailable", domain, status, reason }),
  );
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
  const signal = AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  let url = `${SCAMADVISER_CHECK_BASE}${encodeURIComponent(normalized)}`;

  try {
    let response: Response | null = null;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const current = await fetchImpl(url, {
        method: "GET",
        headers: SCAMADVISER_HEADERS,
        redirect: "manual",
        signal,
      });
      if (current.status < 300 || current.status >= 400) {
        response = current;
        break;
      }
      const location = current.headers?.get("location");
      const next = location ? allowedRedirectTarget(location, url) : null;
      if (!next) {
        logFailure(normalized, location ? "redirect outside scamadviser.com/check-website/" : "redirect without location", current.status);
        return unavailable(normalized);
      }
      url = next;
    }
    if (!response) {
      logFailure(normalized, "too many redirects");
      return unavailable(normalized);
    }

    if (!response.ok) {
      logFailure(normalized, "non-2xx response", response.status);
      return unavailable(normalized);
    }

    const html = await response.text();
    const score = parseRatingScoreFromPage(html);
    if (score === null) {
      logFailure(normalized, `ratingScore not found in page (${html.length} bytes)`, response.status);
      return unavailable(normalized);
    }

    return {
      domain: normalized,
      score,
      source: "scamadvisor",
      checkedAt: new Date().toISOString(),
    };
  } catch (error) {
    const name = error instanceof Error ? error.name : "";
    const reason = name === "TimeoutError" || name === "AbortError" ? "timeout" : `fetch failed: ${String(error).slice(0, 200)}`;
    logFailure(normalized, reason);
    return unavailable(normalized);
  }
}

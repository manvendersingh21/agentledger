import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  isValidTrustDomain,
  normalizeTrustDomain,
  parseRatingScoreFromPage,
  scrapeScamAdviser,
  SCAMADVISER_USER_AGENT,
} from "../../lib/risk/scamadviser-scrape.ts";

const fixturePath = resolve(
  process.cwd(),
  "tests/fixtures/scamadviser-stripe.com.html",
);

describe("parseRatingScoreFromPage", () => {
  it("reads ratingScore from the stripe.com fixture", () => {
    const html = readFileSync(fixturePath, "utf8");
    expect(parseRatingScoreFromPage(html)).toBe(100);
  });

  it("returns null for malformed HTML", () => {
    expect(parseRatingScoreFromPage("<html><body>no score here</body></html>")).toBeNull();
    expect(parseRatingScoreFromPage('"ratingScore": 150')).toBeNull();
  });
});

describe("domain validation", () => {
  it("normalizes hostnames", () => {
    expect(normalizeTrustDomain("https://www.Stripe.com/path")).toBe("stripe.com");
  });

  it("rejects invalid domains", () => {
    expect(isValidTrustDomain("localhost")).toBe(false);
    expect(isValidTrustDomain("127.0.0.1")).toBe(false);
    expect(isValidTrustDomain("not a host")).toBe(false);
    expect(isValidTrustDomain("stripe.com")).toBe(true);
  });
});

describe("scrapeScamAdviser (mocked fetch)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("does not fetch for invalid domains", async () => {
    const fetchImpl = vi.fn();
    const result = await scrapeScamAdviser("127.0.0.1", { fetchImpl });
    expect(result.source).toBe("unavailable");
    expect(result.score).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("parses a successful HTML response", async () => {
    const html = readFileSync(fixturePath, "utf8");
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => html,
    } as Response);

    const result = await scrapeScamAdviser("stripe.com", { fetchImpl });

    expect(result).toMatchObject({
      domain: "stripe.com",
      score: 100,
      source: "scamadvisor",
    });
    expect(fetchImpl).toHaveBeenCalledOnce();
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://www.scamadviser.com/check-website/stripe.com");
    expect(init.headers).toMatchObject({
      "User-Agent": SCAMADVISER_USER_AGENT,
    });
  });

  it("returns unavailable when the page has no score", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => "<html></html>",
    } as Response);

    const result = await scrapeScamAdviser("example.com", { fetchImpl });
    expect(result.source).toBe("unavailable");
    expect(result.score).toBeNull();
  });
});

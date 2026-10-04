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

  it("reads plain, HTML-escaped, and string-escaped JSON", () => {
    expect(parseRatingScoreFromPage('<script>{"props":{"ratingScore":87}}</script>')).toBe(87);
    expect(parseRatingScoreFromPage('<div data-page="{&quot;ratingScore&quot;:64.6}">')).toBe(65);
    expect(parseRatingScoreFromPage('<div data-page="{&#34;ratingScore&#34;:12}">')).toBe(12);
    expect(parseRatingScoreFromPage('self.__next_f.push([1,"{\\"ratingScore\\":91}"])')).toBe(91);
    expect(parseRatingScoreFromPage('{"ratingScore":"78"}')).toBe(78);
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
      "Accept-Language": expect.any(String),
    });
    expect(SCAMADVISER_USER_AGENT).toMatch(/^Mozilla\/5\.0 /);
    expect(init.redirect).toBe("manual");
  });

  it("returns unavailable when the page has no score", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => "<html></html>",
    } as Response);

    const result = await scrapeScamAdviser("example.com", { fetchImpl });
    expect(result.source).toBe("unavailable");
    expect(result.score).toBeNull();
  });

  it("follows redirects that stay on scamadviser.com/check-website/", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 301, headers: { location: "/check-website/example.com/" } }))
      .mockResolvedValueOnce(new Response('{"ratingScore":88}', { status: 200 }));

    const result = await scrapeScamAdviser("example.com", { fetchImpl });
    expect(result).toMatchObject({ score: 88, source: "scamadvisor" });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls[1]?.[0]).toBe("https://www.scamadviser.com/check-website/example.com/");
  });

  it.each([
    "https://evil.example/check-website/example.com",
    "https://www.scamadviser.com/login",
    "http://www.scamadviser.com/check-website/example.com",
  ])("refuses redirect to %s and logs the status", async (location) => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetchImpl = vi.fn().mockResolvedValue(new Response(null, { status: 302, headers: { location } }));

    const result = await scrapeScamAdviser("example.com", { fetchImpl });
    expect(result.source).toBe("unavailable");
    expect(fetchImpl).toHaveBeenCalledOnce();
    const logged = JSON.parse(String(warn.mock.calls[0]?.[0])) as { status: number; reason: string };
    expect(logged.status).toBe(302);
    expect(logged.reason).toMatch(/redirect outside/);
  });

  it("logs the HTTP status when blocked", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetchImpl = vi.fn().mockResolvedValue(new Response("Forbidden", { status: 403 }));

    const result = await scrapeScamAdviser("example.com", { fetchImpl });
    expect(result.source).toBe("unavailable");
    const logged = JSON.parse(String(warn.mock.calls[0]?.[0])) as Record<string, unknown>;
    expect(logged).toMatchObject({ scope: "agentledger:scamadviser", domain: "example.com", status: 403 });
  });
});

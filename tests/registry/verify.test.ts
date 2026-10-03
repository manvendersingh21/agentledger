import { afterEach, describe, expect, it, vi } from "vitest";
import {
  assertSafeVerificationHost,
  checkDnsTxt,
  checkWellKnown,
  UnsafeVerificationHostError,
} from "../../lib/registry/verify.ts";

describe("assertSafeVerificationHost", () => {
  it("accepts a normal hostname", () => {
    expect(assertSafeVerificationHost("example.com")).toBe("example.com");
  });

  it("rejects localhost and private IPs", () => {
    expect(() => assertSafeVerificationHost("localhost")).toThrow(UnsafeVerificationHostError);
    expect(() => assertSafeVerificationHost("127.0.0.1")).toThrow(UnsafeVerificationHostError);
    expect(() => assertSafeVerificationHost("10.0.0.1")).toThrow(UnsafeVerificationHostError);
    expect(() => assertSafeVerificationHost("192.168.1.1")).toThrow(UnsafeVerificationHostError);
  });
});

describe("checkDnsTxt", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns ok when TXT record matches", async () => {
    const token = "abc123";
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        Status: 0,
        Answer: [{ type: 16, data: `"agentledger-verification=${token}"` }],
      }),
    } as Response);

    const result = await checkDnsTxt("example.com", token, { fetchImpl });
    expect(result.ok).toBe(true);
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://cloudflare-dns.com/dns-query?name=_agentledger.example.com&type=TXT",
      { headers: { accept: "application/dns-json" } },
    );
  });

  it("returns miss when TXT record is absent", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ Status: 0, Answer: [] }),
    } as Response);

    const result = await checkDnsTxt("example.com", "token", { fetchImpl });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/TXT/);
  });

  it("rejects unsafe hosts without calling fetch", async () => {
    const fetchImpl = vi.fn();
    const result = await checkDnsTxt("127.0.0.1", "token", { fetchImpl });
    expect(result.ok).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("checkWellKnown", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns ok when well-known JSON matches", async () => {
    const token = "well-known-token";
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      url: "https://example.com/.well-known/agentledger.json",
      json: async () => ({ agentledger_verification: token }),
    } as Response);

    const result = await checkWellKnown("example.com", token, { fetchImpl });
    expect(result.ok).toBe(true);
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://example.com/.well-known/agentledger.json",
      expect.objectContaining({ redirect: "manual" }),
    );
  });

  it("returns miss when token mismatches", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      url: "https://example.com/.well-known/agentledger.json",
      json: async () => ({ agentledger_verification: "other" }),
    } as Response);

    const result = await checkWellKnown("example.com", "expected", { fetchImpl });
    expect(result.ok).toBe(false);
  });

  it("rejects redirect to another host", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      status: 302,
      headers: { get: (name: string) => (name === "location" ? "https://evil.com/.well-known/agentledger.json" : null) },
      url: "https://example.com/.well-known/agentledger.json",
    } as Response);

    const result = await checkWellKnown("example.com", "token", { fetchImpl });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/host/i);
  });

  it("rejects localhost without fetching", async () => {
    const fetchImpl = vi.fn();
    const result = await checkWellKnown("localhost", "token", { fetchImpl });
    expect(result.ok).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

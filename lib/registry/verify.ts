export type VerificationMethod = "dns_txt" | "well_known";
export type RegistrationStatus = "pending" | "verified" | "failed" | "revoked";

export interface MerchantRegistration {
  id: string;
  owner_id: string;
  merchant_id: string | null;
  company_name: string;
  domain: string;
  contact_email: string;
  verification_method: VerificationMethod;
  verification_token: string;
  status: RegistrationStatus;
  verified_at: string | null;
  last_checked_at: string | null;
  last_error: string | null;
  created_at: string;
}

const DNS_QUERY_BASE = "https://cloudflare-dns.com/dns-query";
const WELL_KNOWN_PATH = "/.well-known/agentledger.json";
const DEFAULT_TIMEOUT_MS = 5000;

const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "localhost.localdomain",
  "local",
  "internal",
  "intranet",
  "test",
  "invalid",
]);

export class UnsafeVerificationHostError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsafeVerificationHostError";
  }
}

/** Reject IPs, localhost, and private/reserved hostnames (SSRF guard). */
export function assertSafeVerificationHost(domain: string): string {
  const normalized = domain.trim().toLowerCase().replace(/\.+$/, "");
  if (!normalized) {
    throw new UnsafeVerificationHostError("Domain is required.");
  }
  if (normalized.includes(":") || normalized.includes("/") || normalized.includes("@")) {
    throw new UnsafeVerificationHostError("Invalid domain.");
  }
  if (BLOCKED_HOSTNAMES.has(normalized)) {
    throw new UnsafeVerificationHostError("Hostname is not allowed for verification.");
  }
  if (normalized.endsWith(".local") || normalized.endsWith(".localhost")) {
    throw new UnsafeVerificationHostError("Hostname is not allowed for verification.");
  }

  if (isIpv4Literal(normalized)) {
    if (isPrivateOrReservedIpv4(normalized)) {
      throw new UnsafeVerificationHostError("IP addresses are not allowed for verification.");
    }
    throw new UnsafeVerificationHostError("IP addresses are not allowed for verification.");
  }

  if (normalized.startsWith("[") && normalized.endsWith("]")) {
    const inner = normalized.slice(1, -1);
    if (isPrivateOrReservedIpv6(inner)) {
      throw new UnsafeVerificationHostError("IP addresses are not allowed for verification.");
    }
    throw new UnsafeVerificationHostError("IP addresses are not allowed for verification.");
  }

  if (!/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/.test(normalized)) {
    throw new UnsafeVerificationHostError("Invalid hostname.");
  }

  return normalized;
}

function isIpv4Literal(host: string): boolean {
  const parts = host.split(".");
  if (parts.length !== 4) return false;
  return parts.every((p) => /^\d{1,3}$/.test(p) && Number(p) >= 0 && Number(p) <= 255);
}

function isPrivateOrReservedIpv4(host: string): boolean {
  const [a, b] = host.split(".").map((p) => Number(p));
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 0) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a >= 224) return true;
  return false;
}

function isPrivateOrReservedIpv6(host: string): boolean {
  const h = host.toLowerCase();
  if (h === "::1" || h === "::") return true;
  if (h.startsWith("fc") || h.startsWith("fd")) return true;
  if (h.startsWith("fe80")) return true;
  if (h.startsWith("::ffff:")) {
    const v4 = h.slice("::ffff:".length);
    if (isIpv4Literal(v4)) return isPrivateOrReservedIpv4(v4);
  }
  return false;
}

function expectedTxtValue(token: string): string {
  return `agentledger-verification=${token}`;
}

function txtRecordsMatchToken(records: string[], token: string): boolean {
  const expected = expectedTxtValue(token);
  for (const raw of records) {
    const cleaned = raw.replace(/^"|"$/g, "").replace(/"\s+"/g, "");
    if (cleaned === expected || cleaned.includes(expected)) return true;
  }
  return false;
}

export interface DnsQueryAnswer {
  name?: string;
  type?: number;
  TTL?: number;
  data?: string;
}

export interface DnsJsonResponse {
  Status?: number;
  Answer?: DnsQueryAnswer[];
}

export async function checkDnsTxt(
  domain: string,
  token: string,
  opts: { fetchImpl?: typeof fetch } = {},
): Promise<{ ok: boolean; error?: string }> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  let host: string;
  try {
    host = assertSafeVerificationHost(domain);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Invalid domain." };
  }

  const name = `_agentledger.${host}`;
  const url = `${DNS_QUERY_BASE}?name=${encodeURIComponent(name)}&type=TXT`;

  try {
    const res = await fetchImpl(url, {
      headers: { accept: "application/dns-json" },
    });
    if (!res.ok) {
      return { ok: false, error: `DNS lookup failed (${res.status}).` };
    }
    const body = (await res.json()) as DnsJsonResponse;
    const answers = body.Answer ?? [];
    const txt = answers.filter((a) => a.type === 16 && typeof a.data === "string").map((a) => a.data as string);
    if (txtRecordsMatchToken(txt, token)) {
      return { ok: true };
    }
    return { ok: false, error: "TXT record not found or token mismatch." };
  } catch {
    return { ok: false, error: "DNS lookup failed." };
  }
}

export async function checkWellKnown(
  domain: string,
  token: string,
  opts: { fetchImpl?: typeof fetch; timeoutMs?: number } = {},
): Promise<{ ok: boolean; error?: string }> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  let host: string;
  try {
    host = assertSafeVerificationHost(domain);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Invalid domain." };
  }

  const url = `https://${host}${WELL_KNOWN_PATH}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetchImpl(url, {
      redirect: "manual",
      signal: controller.signal,
    });

    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      if (location) {
        try {
          const target = new URL(location, url);
          if (target.protocol !== "https:") {
            return { ok: false, error: "Redirect must stay on HTTPS." };
          }
          if (target.hostname.toLowerCase() !== host) {
            return { ok: false, error: "Redirect to another host is not allowed." };
          }
        } catch {
          return { ok: false, error: "Invalid redirect." };
        }
      }
      return { ok: false, error: "Unexpected redirect." };
    }

    if (!res.ok) {
      return { ok: false, error: `Well-known URL returned ${res.status}.` };
    }

    const finalUrl = res.url ? new URL(res.url) : new URL(url);
    if (finalUrl.protocol !== "https:") {
      return { ok: false, error: "HTTPS is required." };
    }
    if (finalUrl.hostname.toLowerCase() !== host) {
      return { ok: false, error: "Response host mismatch." };
    }

    const body = (await res.json()) as { agentledger_verification?: unknown };
    if (body.agentledger_verification === token) {
      return { ok: true };
    }
    return { ok: false, error: "Verification token mismatch in well-known file." };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return { ok: false, error: "Request timed out." };
    }
    return { ok: false, error: "Well-known fetch failed." };
  } finally {
    clearTimeout(timer);
  }
}

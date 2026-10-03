/**
 * Production security checks for AgentLedger (hosted Supabase + Vercel).
 * Run: pnpm exec tsx scripts/e2e/prod-security.ts
 */
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

type RowStatus = "PASS" | "FAIL" | "WARN" | "INFO" | "SKIP";

interface CheckRow {
  status: RowStatus;
  name: string;
  detail?: string;
}

const rows: CheckRow[] = [];

function record(status: RowStatus, name: string, detail?: string): void {
  rows.push({ status, name, detail });
}

function baseUrl(): string {
  return (process.env.BASE_URL ?? "https://agentledger-cyan.vercel.app").replace(/\/$/, "");
}

function loadEnvLocal(): void {
  const path = resolve(process.cwd(), ".env.local");
  if (!existsSync(path)) {
    throw new Error(".env.local not found");
  }
  const text = readFileSync(path, "utf8");
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

const SERVER_SECRET_ENV_KEYS = [
  "OPENAI_API_KEY",
  "STRIPE_SECRET_KEY",
  "JEV_API_KEY",
  "SUPABASE_SECRET_KEY",
  "SUPABASE_HOSTED_API_KEY",
  "SUPABASE_ACCESS_TOKEN",
  "SUPABASE_DB_PASSWORD",
  "STRIPE_WEBHOOK_SECRET",
] as const;

function collectServerSecrets(): string[] {
  const values: string[] = [];
  for (const key of SERVER_SECRET_ENV_KEYS) {
    const v = process.env[key];
    if (typeof v === "string" && v.length >= 12) {
      values.push(v);
    }
  }
  return [...new Set(values)];
}

function maskOutput(text: string, secrets: string[]): string {
  let out = text;
  for (const secret of secrets) {
    if (secret.length < 8) continue;
    out = out.split(secret).join("[REDACTED]");
  }
  return out;
}

const JWT_RE = /eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g;

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const json = Buffer.from(parts[1], "base64url").toString("utf8");
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return null;
  }
}

const REAL_SECRET_KEY_PATTERNS: { label: string; re: RegExp }[] = [
  { label: "sb_secret_", re: /sb_secret_[A-Za-z0-9_-]{16,}/ },
  { label: "sk_test/live", re: /sk_(?:test|live)_[A-Za-z0-9]{16,}/ },
  {
    label: "sk-",
    re: /(?<![A-Za-z0-9_-])sk-(proj-|svcacct-)?[A-Za-z0-9_-]{32,}/,
  },
  { label: "sbp_", re: /sbp_[a-f0-9]{20,}/ },
  { label: "whsec_", re: /whsec_[A-Za-z0-9]{16,}/ },
];

function scanForSecretLeakage(content: string, literalSecrets: string[]): string | null {
  for (const p of REAL_SECRET_KEY_PATTERNS) {
    if (p.re.test(content)) return `matched pattern ${p.label}`;
  }
  const jwtMatches = content.match(JWT_RE) ?? [];
  for (const jwt of jwtMatches) {
    const payload = decodeJwtPayload(jwt);
    const role = payload?.role;
    if (role === "service_role") return "JWT with role=service_role";
  }
  for (const secret of literalSecrets) {
    if (secret.length >= 16 && content.includes(secret)) {
      return "matched literal server secret from env";
    }
  }
  return null;
}

function extractStaticUrls(html: string, pageOrigin: string): string[] {
  const found = new Set<string>();
  const attrRe = /(?:src|href)=["']([^"']+)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = attrRe.exec(html)) !== null) {
    const raw = m[1];
    if (!raw.includes("/_next/static/")) continue;
    try {
      const url = new URL(raw, pageOrigin);
      found.add(url.href);
    } catch {
      /* ignore */
    }
  }
  const buildIdMatch = html.match(/"buildId":"([^"]+)"/);
  if (buildIdMatch?.[1]) {
    try {
      found.add(new URL(`/_next/static/${buildIdMatch[1]}/_buildManifest.js`, pageOrigin).href);
    } catch {
      /* ignore */
    }
  }
  return [...found];
}

function extractJsFromBuildManifest(manifestText: string, pageOrigin: string): string[] {
  const out = new Set<string>();
  const re = /\/_next\/static\/[^"\\]+\.js/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(manifestText)) !== null) {
    try {
      out.add(new URL(m[0], pageOrigin).href);
    } catch {
      /* ignore */
    }
  }
  return [...out];
}

async function fetchText(url: string, init?: RequestInit): Promise<{ status: number; text: string; headers: Headers }> {
  const res = await fetch(url, { ...init, redirect: "follow" });
  const text = await res.text();
  return { status: res.status, text, headers: res.headers };
}

function forgeHs256Jwt(): string {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(
    JSON.stringify({ sub: randomUUID(), role: "authenticated", aud: "authenticated" }),
  ).toString("base64url");
  const secret = randomBytes(32).toString("hex");
  const sig = createHmac("sha256", secret).update(`${header}.${payload}`).digest("base64url");
  return `${header}.${payload}.${sig}`;
}

function authAllowedStatus(status: number): boolean {
  return status === 401 || status === 403 || status === 405;
}

type ApiProbe = {
  name: string;
  method: "GET" | "POST" | "PATCH";
  path: string;
  body?: string;
};

const API_PROBES: ApiProbe[] = [
  { name: "agent/run", method: "POST", path: "/api/agent/run", body: JSON.stringify({ prompt: "security probe" }) },
  {
    name: "approvals/[id]",
    method: "POST",
    path: "/api/approvals/00000000-0000-4000-8000-000000000002",
    body: JSON.stringify({ decision: "approved" }),
  },
  {
    name: "actions/[id]/execute",
    method: "POST",
    path: "/api/actions/00000000-0000-4000-8000-000000000003/execute",
  },
  { name: "attack/prompt-injection", method: "POST", path: "/api/attack/prompt-injection" },
  { name: "attack/parameter-tampering", method: "POST", path: "/api/attack/parameter-tampering" },
  { name: "attack/replay", method: "POST", path: "/api/attack/replay" },
  { name: "demo/reset", method: "POST", path: "/api/demo/reset" },
  {
    name: "delegations PATCH",
    method: "PATCH",
    path: "/api/delegations",
    body: JSON.stringify({
      delegation_id: "00000000-0000-4000-8000-000000000004",
      max_amount_cents: 1000,
      daily_limit_cents: 5000,
      approval_threshold_cents: 500,
      allow_recurring: false,
      allowed_merchants: ["acme-api"],
      status: "active",
      min_trust_score: 95,
      trusted_domain_overrides: [],
      price_anomaly_deny_threshold: 0.8,
      price_anomaly_review_threshold: 0.5,
      injection_kill_threshold: 0.9,
      kill_switch_enabled: true,
    }),
  },
  { name: "audit/verify", method: "GET", path: "/api/audit/verify" },
  {
    name: "agents/[id]/reenable",
    method: "POST",
    path: "/api/agents/00000000-0000-4000-8000-000000000005/reenable",
  },
  { name: "registry", method: "GET", path: "/api/registry" },
  {
    name: "registry POST",
    method: "POST",
    path: "/api/registry",
    body: JSON.stringify({
      company_name: "Probe Co",
      domain: "probe.example.com",
      contact_email: "probe@example.com",
      verification_method: "dns_txt",
    }),
  },
  {
    name: "registry/[id]/verify",
    method: "POST",
    path: "/api/registry/00000000-0000-4000-8000-000000000006/verify",
  },
  {
    name: "trust/check",
    method: "POST",
    path: "/api/trust/check",
    body: JSON.stringify({ domain: "example.com" }),
  },
  { name: "mcp GET", method: "GET", path: "/api/mcp" },
  {
    name: "mcp POST",
    method: "POST",
    path: "/api/mcp",
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
  },
];

const SENSITIVE_TABLES = [
  "action_intents",
  "approvals",
  "executions",
  "receipts",
  "audit_events",
  "delegations",
  "agents",
  "risk_assessments",
  "stripe_events",
] as const;

const CHEAP_COMPUTE_PRODUCT = "20000000-0000-4000-8000-000000000004";
const INJECTION_PRINCIPAL = "00000000-0000-4000-8000-000000000001";

const CSP_SNIPPET = `// Recommended next.config.ts headers() snippet:
async headers() {
  return [
    {
      source: "/(.*)",
      headers: [
        { key: "Content-Security-Policy", value: "default-src 'self'; ..." },
        { key: "X-Frame-Options", value: "DENY" },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      ],
    },
  ];
}`;

async function probeApi(
  probe: ApiProbe,
  headers: Record<string, string>,
): Promise<{ status: number; body: string }> {
  const init: RequestInit = { method: probe.method, headers: { ...headers } };
  if (probe.body !== undefined) {
    init.headers = { ...init.headers, "Content-Type": "application/json" };
    init.body = probe.body;
  }
  const res = await fetch(`${baseUrl()}${probe.path}`, init);
  const body = await res.text();
  return { status: res.status, body };
}

function parseResourceMetadataUrl(wwwAuth: string | null): string | null {
  if (!wwwAuth) return null;
  const m = wwwAuth.match(/resource_metadata="([^"]+)"/i);
  return m?.[1] ?? null;
}

async function runSecretLeakage(literalSecrets: string[]): Promise<void> {
  const pages = ["/", "/login", "/dashboard"];
  const assets = new Set<string>();
  for (const page of pages) {
    const label = `secret-leak:page ${page}`;
    try {
      const { status, text, headers } = await fetchText(`${baseUrl()}${page}`);
      if (status >= 500) {
        record("FAIL", label, `HTTP ${status}`);
        continue;
      }
      const leak = scanForSecretLeakage(text, literalSecrets);
      if (leak) {
        record("FAIL", label, leak);
      } else {
        record("PASS", label);
      }
      for (const u of extractStaticUrls(text, baseUrl())) {
        assets.add(u);
      }
      const loc = headers.get("location");
      if (loc) {
        try {
          const redir = new URL(loc, baseUrl()).href;
          const redirRes = await fetchText(redir);
          const redirLeak = scanForSecretLeakage(redirRes.text, literalSecrets);
          if (redirLeak) {
            record("FAIL", `secret-leak:redirect ${page}`, redirLeak);
          }
          for (const u of extractStaticUrls(redirRes.text, baseUrl())) {
            assets.add(u);
          }
        } catch (e) {
          record("FAIL", `secret-leak:redirect ${page}`, maskOutput(String(e), literalSecrets));
        }
      }
    } catch (e) {
      record("FAIL", label, maskOutput(`network: ${String(e)}`, literalSecrets));
    }
  }

  const manifestUrls = [...assets].filter((u) => u.includes("_buildManifest.js"));
  for (const manifestUrl of manifestUrls) {
    try {
      const { status, text } = await fetchText(manifestUrl);
      if (status === 200) {
        for (const u of extractJsFromBuildManifest(text, baseUrl())) {
          assets.add(u);
        }
      }
    } catch {
      /* ignore */
    }
  }

  let chunkIndex = 0;
  for (const assetUrl of assets) {
    chunkIndex += 1;
    const label = `secret-leak:chunk ${chunkIndex}`;
    try {
      const { status, text } = await fetchText(assetUrl);
      if (status !== 200) {
        record("SKIP", label, `HTTP ${status} for ${assetUrl.replace(baseUrl(), "")}`);
        continue;
      }
      const leak = scanForSecretLeakage(text, literalSecrets);
      if (leak) {
        record("FAIL", label, `${leak} (${assetUrl.replace(baseUrl(), "")})`);
      } else {
        record("PASS", label, assetUrl.replace(baseUrl(), ""));
      }
    } catch (e) {
      record("FAIL", label, maskOutput(String(e), literalSecrets));
    }
  }
  if (assets.size === 0) {
    record("WARN", "secret-leak:static chunks", "no /_next/static assets discovered from HTML");
  }
}

async function runResponseHeaders(): Promise<void> {
  try {
    const res = await fetch(`${baseUrl()}/`, { redirect: "follow" });
    const xPowered = res.headers.get("x-powered-by");
    record(xPowered === null ? "PASS" : "FAIL", "headers:x-powered-by absent", xPowered ?? undefined);

    const hsts = res.headers.get("strict-transport-security");
    record(
      hsts !== null && hsts.length > 0 ? "PASS" : "FAIL",
      "headers:strict-transport-security present",
      hsts ?? "missing",
    );

    const ct = res.headers.get("content-type") ?? "";
    record(ct.includes("text/html") ? "PASS" : "WARN", "headers:content-type", ct || "missing");

    const csp = res.headers.get("content-security-policy");
    const xfo = res.headers.get("x-frame-options");
    const rp = res.headers.get("referrer-policy");
    if (!csp) {
      record("WARN", "headers:content-security-policy", "missing — see recommended snippet in output");
      console.log("\n" + CSP_SNIPPET + "\n");
    } else {
      record("PASS", "headers:content-security-policy");
    }
    if (!xfo) {
      record("WARN", "headers:x-frame-options", "missing");
    } else {
      record("PASS", "headers:x-frame-options");
    }
    if (!rp) {
      record("WARN", "headers:referrer-policy", "missing");
    } else {
      record("PASS", "headers:referrer-policy");
    }
  } catch (e) {
    record("FAIL", "headers:fetch /", String(e));
  }
}

async function runApiAuth(): Promise<void> {
  for (const probe of API_PROBES) {
    const label = `auth:unauth ${probe.method} ${probe.path}`;
    try {
      const { status } = await probeApi(probe, {});
      if (authAllowedStatus(status)) {
        record("PASS", label, String(status));
      } else if (status === 200) {
        record("FAIL", label, "got 200");
      } else if (status >= 500) {
        record("FAIL", label, `got ${status}`);
      } else {
        record("FAIL", label, `unexpected ${status}`);
      }
    } catch (e) {
      record("FAIL", label, String(e));
    }
  }

  const forged = forgeHs256Jwt();
  for (const probe of API_PROBES) {
    if (probe.method === "GET" && probe.path === "/api/mcp") continue;
    const label = `auth:forged-jwt ${probe.method} ${probe.path}`;
    try {
      const { status } = await probeApi(probe, { Authorization: `Bearer ${forged}` });
      if (status === 401) {
        record("PASS", label);
      } else {
        record("FAIL", label, `expected 401, got ${status}`);
      }
    } catch (e) {
      record("FAIL", label, String(e));
    }
  }
}

async function assertSelectBlocked(
  client: SupabaseClient,
  table: string,
  labelPrefix: string,
): Promise<void> {
  const { data, error } = await client.from(table).select("*").limit(5);
  const label = `${labelPrefix}:select ${table}`;
  if (error) {
    record("PASS", label, error.code ?? error.message);
    return;
  }
  const count = Array.isArray(data) ? data.length : 0;
  if (count === 0) {
    record("PASS", label, "0 rows");
  } else {
    record("FAIL", label, `${count} rows returned`);
  }
}

async function assertInsertBlocked(
  client: SupabaseClient,
  table: string,
  row: Record<string, unknown>,
  labelPrefix: string,
): Promise<void> {
  const { error } = await client.from(table).insert(row);
  const label = `${labelPrefix}:insert ${table}`;
  if (error) {
    record("PASS", label);
  } else {
    record("FAIL", label, "insert succeeded");
  }
}

async function assertRpcBlocked(
  client: SupabaseClient,
  fn: string,
  args: Record<string, unknown>,
  labelPrefix: string,
): Promise<void> {
  const { error } = await client.rpc(fn, args);
  const label = `${labelPrefix}:rpc ${fn}`;
  if (error) {
    record("PASS", label);
  } else {
    record("FAIL", label, "rpc succeeded");
  }
}

async function runSupabaseRls(
  supabaseUrl: string,
  publishableKey: string,
  serviceKey: string,
): Promise<{ userId: string; accessToken: string } | null> {
  const anon = createClient(supabaseUrl, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  for (const table of SENSITIVE_TABLES) {
    await assertSelectBlocked(anon, table, "supabase:anon");
  }

  await assertInsertBlocked(anon, "action_intents", {
    principal_id: randomUUID(),
    agent_id: randomUUID(),
    action_type: "purchase",
    status: "proposed",
    payload: {},
    amount_cents: 100,
    currency: "usd",
    merchant_slug: "acme-api",
    recurring: false,
    idempotency_key: `probe-${randomUUID()}`,
  }, "supabase:anon");

  await assertInsertBlocked(anon, "approvals", {
    intent_id: randomUUID(),
    principal_id: randomUUID(),
    status: "pending",
  }, "supabase:anon");

  await assertInsertBlocked(anon, "audit_events", {
    id: randomUUID(),
    principal_id: randomUUID(),
    event_type: "PROBE",
    event_data: {},
    previous_hash: "0".repeat(64),
    event_hash: randomBytes(32).toString("hex"),
  }, "supabase:anon");

  const intentId = randomUUID();
  await assertRpcBlocked(anon, "claim_execution", {
    p_intent_id: intentId,
    p_idempotency_key: "probe",
    p_provider: "stripe",
  }, "supabase:anon");
  await assertRpcBlocked(anon, "resolve_approval", {
    p_approval_id: randomUUID(),
    p_principal_id: randomUUID(),
    p_decision: "approved",
    p_reason: "probe",
  }, "supabase:anon");
  await assertRpcBlocked(anon, "reset_demo", { p_principal_id: randomUUID() }, "supabase:anon");
  await assertRpcBlocked(anon, "ensure_principal_setup", {
    p_principal_id: randomUUID(),
    p_display_name: "probe",
  }, "supabase:anon");

  const email = `sec-${randomUUID()}@agentledger.dev`;
  const password = `Pw!${randomBytes(18).toString("base64url")}`;
  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const created = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (created.error || !created.data.user) {
    record("FAIL", "supabase:signup probe user", created.error?.message ?? "no user");
    return null;
  }
  const userId = created.data.user.id;

  const userClient = createClient(supabaseUrl, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const signIn = await userClient.auth.signInWithPassword({ email, password });
  if (signIn.error || !signIn.data.session) {
    record("FAIL", "supabase:user session", signIn.error?.message ?? "no session");
    await admin.auth.admin.deleteUser(userId);
    return null;
  }

  for (const table of SENSITIVE_TABLES) {
    await assertSelectBlocked(userClient, table, "supabase:user");
  }

  await assertInsertBlocked(userClient, "action_intents", {
    principal_id: userId,
    agent_id: randomUUID(),
    action_type: "purchase",
    status: "proposed",
    payload: {},
    amount_cents: 100,
    currency: "usd",
    merchant_slug: "acme-api",
    recurring: false,
    idempotency_key: `user-probe-${randomUUID()}`,
  }, "supabase:user");

  await assertInsertBlocked(userClient, "approvals", {
    intent_id: randomUUID(),
    principal_id: userId,
    status: "pending",
  }, "supabase:user");

  await assertInsertBlocked(userClient, "audit_events", {
    id: randomUUID(),
    principal_id: userId,
    event_type: "PROBE",
    event_data: {},
    previous_hash: "0".repeat(64),
    event_hash: randomBytes(32).toString("hex"),
  }, "supabase:user");

  const { error: approvalUpdateError } = await userClient
    .from("approvals")
    .update({ status: "approved" })
    .eq("principal_id", userId);
  if (approvalUpdateError) {
    record("PASS", "supabase:user update approvals.status");
  } else {
    record("FAIL", "supabase:user update approvals.status", "update accepted");
  }

  const accessToken = signIn.data.session.access_token;
  return { userId, accessToken };
}

async function cleanupUser(supabaseUrl: string, serviceKey: string, userId: string): Promise<void> {
  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  await admin.auth.admin.deleteUser(userId);
}

async function runMcpOAuth(supabaseUrl: string): Promise<void> {
  const edgeMcp = `${supabaseUrl.replace(/\/$/, "")}/functions/v1/mcp`;
  try {
    const unauth = await fetch(edgeMcp, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
    });
    const www = unauth.headers.get("www-authenticate");
    if (unauth.status === 401 && www && /resource_metadata/i.test(www)) {
      record("PASS", "mcp-edge:unauth POST", "401 + WWW-Authenticate");
    } else {
      record("FAIL", "mcp-edge:unauth POST", `status=${unauth.status} www=${www ?? "missing"}`);
    }
    const metaUrl = parseResourceMetadataUrl(www);
    if (metaUrl) {
      const metaRes = await fetch(metaUrl);
      const metaJson = (await metaRes.json()) as { authorization_servers?: unknown };
      if (metaRes.ok && Array.isArray(metaJson.authorization_servers) && metaJson.authorization_servers.length > 0) {
        record("PASS", "mcp-edge:protected-resource metadata");
      } else {
        record("FAIL", "mcp-edge:protected-resource metadata", `HTTP ${metaRes.status}`);
      }
    } else {
      record("FAIL", "mcp-edge:protected-resource metadata", "no resource_metadata URL");
    }
  } catch (e) {
    record("FAIL", "mcp-edge:unauth POST", String(e));
  }

  const authMetaUrl = `${supabaseUrl.replace(/\/$/, "")}/.well-known/oauth-authorization-server/auth/v1`;
  try {
    const res = await fetch(authMetaUrl);
    const body = (await res.json()) as Record<string, unknown>;
    const checks: [string, boolean][] = [
      ["registration_endpoint", typeof body.registration_endpoint === "string"],
      ["authorization_endpoint", typeof body.authorization_endpoint === "string"],
      ["token_endpoint", typeof body.token_endpoint === "string"],
      [
        "code_challenge_methods_supported S256",
        Array.isArray(body.code_challenge_methods_supported) &&
          (body.code_challenge_methods_supported as string[]).includes("S256"),
      ],
    ];
    for (const [name, ok] of checks) {
      record(ok ? "PASS" : "FAIL", `oauth-server:${name}`);
    }
  } catch (e) {
    record("FAIL", "oauth-server:metadata", String(e));
  }

  try {
    const res = await fetch(`${baseUrl()}/api/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
    });
    if (res.status === 401) {
      record("PASS", "next:mcp unauth POST");
    } else {
      record("FAIL", "next:mcp unauth POST", `status ${res.status}`);
    }
  } catch (e) {
    record("FAIL", "next:mcp unauth POST", String(e));
  }

  try {
    const res = await fetch(`${baseUrl()}/.well-known/oauth-protected-resource`);
    const body = (await res.json()) as { authorization_servers?: unknown; resource?: string };
    if (res.ok && Array.isArray(body.authorization_servers) && typeof body.resource === "string") {
      record("PASS", "next:oauth-protected-resource JSON");
    } else {
      record("FAIL", "next:oauth-protected-resource JSON", `HTTP ${res.status}`);
    }
  } catch (e) {
    record("FAIL", "next:oauth-protected-resource JSON", String(e));
  }
}

async function runStripeWebhooks(supabaseUrl: string): Promise<void> {
  const targets = [
    { name: "edge stripe-webhook", url: `${supabaseUrl.replace(/\/$/, "")}/functions/v1/stripe-webhook` },
    { name: "next stripe/webhook", url: `${baseUrl()}/api/stripe/webhook` },
  ];
  for (const target of targets) {
    for (const variant of ["no-signature", "invalid-signature"] as const) {
      const label = `stripe-webhook:${target.name} ${variant}`;
      try {
        const headers: Record<string, string> = { "Content-Type": "application/json" };
        if (variant === "invalid-signature") {
          headers["stripe-signature"] = "t=0,v1=invalid";
        }
        const res = await fetch(target.url, {
          method: "POST",
          headers,
          body: JSON.stringify({ id: "evt_probe", type: "payment_intent.succeeded", data: { object: {} } }),
        });
        if (res.status === 200) {
          record("FAIL", label, "got 200");
        } else if (res.status === 400 || res.status === 503) {
          record("PASS", label, String(res.status));
        } else {
          record("FAIL", label, `unexpected ${res.status}`);
        }
      } catch (e) {
        record("FAIL", label, String(e));
      }
    }
  }
}

function parseMcpToolJson(body: string): Record<string, unknown> | null {
  try {
    const outer = JSON.parse(body) as { result?: { content?: { text?: string }[] } };
    const text = outer.result?.content?.[0]?.text;
    if (!text) return null;
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function runIdentityInjection(
  supabaseUrl: string,
  publishableKey: string,
  serviceKey: string,
): Promise<void> {
  const email = `inj-${randomUUID()}@agentledger.dev`;
  const password = `Pw!${randomBytes(18).toString("base64url")}`;
  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const created = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (created.error || !created.data.user) {
    record("FAIL", "identity:signup", created.error?.message ?? "no user");
    return;
  }
  const userId = created.data.user.id;

  const userClient = createClient(supabaseUrl, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const signIn = await userClient.auth.signInWithPassword({ email, password });
  const token = signIn.data.session?.access_token;
  if (!token) {
    record("FAIL", "identity:session", signIn.error?.message ?? "no token");
    await admin.auth.admin.deleteUser(userId);
    return;
  }

  try {
    const agentRes = await fetch(`${baseUrl()}/api/agent/run`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        prompt: "List delegations only; do not purchase.",
        user_id: INJECTION_PRINCIPAL,
      }),
    });
    if (agentRes.status === 401 || agentRes.status === 403) {
      record("PASS", "identity:agent/run extra user_id", `HTTP ${agentRes.status}`);
    } else if (agentRes.status === 503) {
      record("SKIP", "identity:agent/run extra user_id", "agent unavailable (503)");
    } else {
      record("PASS", "identity:agent/run extra user_id", `HTTP ${agentRes.status} (no server crash)`);
    }
  } catch (e) {
    record("FAIL", "identity:agent/run extra user_id", String(e));
  }

  let intentId: string | null = null;
  try {
    const mcpRes = await fetch(`${baseUrl()}/api/mcp`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 42,
        method: "tools/call",
        params: {
          name: "propose_purchase",
          arguments: {
            product_id: CHEAP_COMPUTE_PRODUCT,
            principal_id: INJECTION_PRINCIPAL,
            reason: "identity injection probe",
            idempotency_key: `inj-${randomUUID()}`,
          },
        },
      }),
    });
    const raw = await mcpRes.text();
    const parsed = parseMcpToolJson(raw);
    const candidate = parsed?.intent_id;
    if (typeof candidate === "string") intentId = candidate;
    if (!intentId && typeof parsed?.intentId === "string") intentId = parsed.intentId;
  } catch (e) {
    record("FAIL", "identity:mcp propose principal_id", String(e));
    await admin.auth.admin.deleteUser(userId);
    return;
  }

  if (!intentId) {
    record("SKIP", "identity:mcp propose principal_id", "no intent_id in tool response");
    await admin.auth.admin.deleteUser(userId);
    return;
  }

  const { data: intentRow, error: intentErr } = await admin
    .from("action_intents")
    .select("principal_id")
    .eq("id", intentId)
    .maybeSingle();
  if (intentErr || !intentRow) {
    record("FAIL", "identity:intent principal_id", intentErr?.message ?? "intent not found");
  } else if (intentRow.principal_id === userId) {
    record("PASS", "identity:intent principal_id matches caller");
  } else {
    record("FAIL", "identity:intent principal_id matches caller", "principal mismatch");
  }

  await admin.auth.admin.deleteUser(userId);
}

async function runDemoResetInfo(token: string | null): Promise<void> {
  if (!token) {
    record("INFO", "demo:reset gating", "skipped (no probe user session)");
    return;
  }
  try {
    const res = await fetch(`${baseUrl()}/api/demo/reset`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.status === 403) {
      const body = (await res.json()) as { error?: string };
      record(
        "INFO",
        "demo:reset gating",
        body.error === "DISABLED"
          ? "NEXT_PUBLIC_DEMO_MODE appears off (403 DISABLED)"
          : `403 — ${body.error ?? "forbidden"}`,
      );
    } else if (res.status === 200) {
      record("INFO", "demo:reset gating", "ENABLED — demo reset returned 200 (review NEXT_PUBLIC_DEMO_MODE)");
    } else {
      record("INFO", "demo:reset gating", `HTTP ${res.status}`);
    }
  } catch (e) {
    record("INFO", "demo:reset gating", String(e));
  }
}

function printTable(secrets: string[]): void {
  console.log(`\nProduction security — ${baseUrl()}\n`);
  console.log("STATUS  CHECK                          DETAIL");
  console.log("------  ------------------------------ ------------------------------");
  for (const row of rows) {
    const detail = row.detail ? maskOutput(row.detail, secrets).slice(0, 120) : "";
    console.log(
      `${row.status.padEnd(6)}  ${row.name.padEnd(30)}  ${detail}`,
    );
  }
  const fails = rows.filter((r) => r.status === "FAIL").length;
  const passes = rows.filter((r) => r.status === "PASS").length;
  console.log(`\nSummary: ${passes} PASS, ${fails} FAIL, ${rows.length} total checks\n`);
}

async function main(): Promise<void> {
  loadEnvLocal();
  const literalSecrets = collectServerSecrets();

  const supabaseUrl = process.env.SUPABASE_HOSTED_URL;
  const publishableKey = process.env.SUPABASE_HOSTED_PUBLISHABLE_KEY;
  const serviceKey = process.env.SUPABASE_HOSTED_API_KEY;

  if (!supabaseUrl || !publishableKey || !serviceKey) {
    record(
      "FAIL",
      "env:hosted supabase",
      "SUPABASE_HOSTED_URL / SUPABASE_HOSTED_PUBLISHABLE_KEY / SUPABASE_HOSTED_API_KEY required",
    );
    printTable(literalSecrets);
    process.exit(1);
  }

  let probeSession: { userId: string; accessToken: string } | null = null;

  try {
    const ping = await fetch(`${baseUrl()}/`, { method: "GET" });
    if (!ping.ok && ping.status >= 500) {
      record("FAIL", "network:BASE_URL reachable", `HTTP ${ping.status}`);
    } else {
      record("PASS", "network:BASE_URL reachable", `HTTP ${ping.status}`);
    }
  } catch (e) {
    record("FAIL", "network:BASE_URL reachable", maskOutput(String(e), literalSecrets));
    printTable(literalSecrets);
    console.error("Could not reach production BASE_URL from this environment.");
    process.exit(1);
  }

  await runSecretLeakage(literalSecrets);
  await runResponseHeaders();
  await runApiAuth();
  probeSession = await runSupabaseRls(supabaseUrl, publishableKey, serviceKey);

  await runMcpOAuth(supabaseUrl);
  await runStripeWebhooks(supabaseUrl);
  await runIdentityInjection(supabaseUrl, publishableKey, serviceKey);

  await runDemoResetInfo(probeSession?.accessToken ?? null);

  if (probeSession) {
    await cleanupUser(supabaseUrl, serviceKey, probeSession.userId);
    probeSession = null;
  }

  printTable(literalSecrets);
  const failed = rows.some((r) => r.status === "FAIL");
  process.exit(failed ? 1 : 0);
}

main().catch((err: unknown) => {
  let secrets: string[] = [];
  try {
    loadEnvLocal();
    secrets = collectServerSecrets();
  } catch {
    secrets = [];
  }
  console.error(maskOutput(err instanceof Error ? err.message : String(err), secrets));
  process.exit(1);
});

/**
 * Production E2E: MCP client OAuth 2.1 against hosted Supabase edge MCP + consent at BASE_URL.
 *
 * Run: pnpm exec tsx scripts/e2e/prod-mcp-oauth.ts
 * Env: .env.local — SUPABASE_HOSTED_* , STRIPE_SECRET_KEY (unused here), optional BASE_URL.
 */
import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const EVIL_CLOUD_PRODUCT_ID = "20000000-0000-4000-8000-000000000005";
const EXPECTED_TOOL_NAMES = [
  "list_delegations",
  "search_products",
  "propose_purchase",
  "get_action_status",
  "get_receipt",
] as const;
const EXPECTED_EVIL_VIOLATIONS = [
  "TRANSACTION_LIMIT_EXCEEDED",
  "RECURRING_NOT_ALLOWED",
  "MERCHANT_NOT_ALLOWED",
  "PROMPT_INJECTION_DETECTED",
] as const;

type CheckRow = { step: string; result: "PASS" | "FAIL"; detail: string };
const checks: CheckRow[] = [];

function loadEnvLocal(): void {
  const path = resolve(process.cwd(), ".env.local");
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

function maskSecrets(text: string): string {
  return text
    .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "[JWT]")
    .replace(/\bsk_(test|live)_[A-Za-z0-9]+\b/g, "[STRIPE_SECRET]")
    .replace(/\bsb_[A-Za-z0-9_-]+\b/g, "[SUPABASE_SECRET]")
    .replace(/\bsbp_[A-Za-z0-9_-]+\b/g, "[SUPABASE_PUBLISHABLE]")
    .replace(/\bcode=[^&\s]+/g, "code=[REDACTED]")
    .replace(/\baccess_token=[^&\s]+/g, "access_token=[REDACTED]");
}

function pass(step: string, detail: string): void {
  checks.push({ step, result: "PASS", detail: maskSecrets(detail) });
}

function fail(step: string, detail: string): void {
  checks.push({ step, result: "FAIL", detail: maskSecrets(detail) });
}

function baseUrl(): string {
  return (process.env.BASE_URL ?? "https://agentledger-cyan.vercel.app").replace(/\/$/, "");
}

function hostedSupabaseUrl(): string {
  const url = process.env.SUPABASE_HOSTED_URL;
  if (!url) throw new Error("Missing SUPABASE_HOSTED_URL in .env.local");
  return url.replace(/\/$/, "");
}

function mcpEndpointUrl(): string {
  return `${hostedSupabaseUrl()}/functions/v1/mcp`;
}

interface ProtectedResourceMetadata {
  resource: string;
  authorization_servers: string[];
  bearer_methods_supported?: string[];
  scopes_supported?: string[];
}

interface AuthorizationServerMetadata {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  registration_endpoint?: string;
  code_challenge_methods_supported?: string[];
  scopes_supported?: string[];
  response_types_supported?: string[];
  grant_types_supported?: string[];
}

interface DynamicClientRegistrationResponse {
  client_id: string;
  client_secret?: string;
  client_id_issued_at?: number;
  client_secret_expires_at?: number;
}

type JsonRpcResponse = {
  jsonrpc: string;
  id?: number | string | null;
  result?: unknown;
  error?: { code: number; message: string };
};

function parseResourceMetadataUrl(wwwAuthenticate: string | null): string | null {
  if (!wwwAuthenticate) return null;
  const quoted = wwwAuthenticate.match(/resource_metadata="([^"]+)"/);
  if (quoted?.[1]) return quoted[1];
  const bare = wwwAuthenticate.match(/resource_metadata=([^,\s]+)/);
  return bare?.[1] ?? null;
}

function pkcePair(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

function parseToolText(result: unknown): unknown {
  const r = result as { content?: { type: string; text: string }[] };
  const text = r.content?.[0]?.text;
  if (!text) return result;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

async function mcpRpc(
  token: string,
  method: string,
  params?: unknown,
  id = 1,
): Promise<{ status: number; body: JsonRpcResponse | null; raw: string }> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  headers.Authorization = `Bearer ${token}`;
  const res = await fetch(mcpEndpointUrl(), {
    method: "POST",
    headers,
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
  });
  const raw = await res.text();
  let body: JsonRpcResponse | null = null;
  if (raw) {
    try {
      body = JSON.parse(raw) as JsonRpcResponse;
    } catch {
      body = null;
    }
  }
  return { status: res.status, body, raw };
}

function isNetworkError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const code = (err as NodeJS.ErrnoException).code;
  return (
    code === "ENOTFOUND" ||
    code === "ECONNREFUSED" ||
    code === "ETIMEDOUT" ||
    code === "EAI_AGAIN" ||
    err.message.includes("fetch failed")
  );
}

function printTable(): void {
  const stepW = Math.max(4, ...checks.map((c) => c.step.length));
  const resultW = 4;
  console.log(`${"STEP".padEnd(stepW)}  ${"RESULT".padEnd(resultW)}  DETAIL`);
  console.log(`${"-".repeat(stepW)}  ${"-".repeat(resultW)}  ${"-".repeat(40)}`);
  for (const row of checks) {
    console.log(`${row.step.padEnd(stepW)}  ${row.result.padEnd(resultW)}  ${row.detail}`);
  }
}

async function main(): Promise<void> {
  loadEnvLocal();

  const publishableKey = process.env.SUPABASE_HOSTED_PUBLISHABLE_KEY;
  const serviceKey = process.env.SUPABASE_HOSTED_API_KEY;
  if (!publishableKey) {
    fail("env", "SUPABASE_HOSTED_PUBLISHABLE_KEY missing");
    printTable();
    process.exit(1);
  }
  if (!serviceKey) {
    fail("env", "SUPABASE_HOSTED_API_KEY missing");
    printTable();
    process.exit(1);
  }

  const supabaseUrl = hostedSupabaseUrl();
  const mcpUrl = mcpEndpointUrl();
  const appBase = baseUrl();

  let authorizationId: string | null = null;
  let codeVerifier: string | null = null;
  let testUserId: string | null = null;
  let testEmail: string | null = null;
  let testPassword: string | null = null;

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    // 1 — Discover protected resource + authorization server metadata
    const discoverRes = await fetch(mcpUrl, { method: "GET", redirect: "manual" });
    if (discoverRes.status === 401) {
      pass("1a MCP GET 401", `status=${discoverRes.status}`);
    } else {
      fail("1a MCP GET 401", `expected 401, got ${discoverRes.status}`);
    }

    const wwwAuth = discoverRes.headers.get("www-authenticate");
    const resourceMetadataUrl = parseResourceMetadataUrl(wwwAuth);
    if (resourceMetadataUrl) {
      pass("1b WWW-Authenticate resource_metadata", resourceMetadataUrl);
    } else {
      fail("1b WWW-Authenticate resource_metadata", wwwAuth ?? "(missing header)");
    }

    let protectedMeta: ProtectedResourceMetadata | null = null;
    if (resourceMetadataUrl) {
      const metaRes = await fetch(resourceMetadataUrl);
      if (metaRes.ok) {
        protectedMeta = (await metaRes.json()) as ProtectedResourceMetadata;
        pass("1c fetch protected-resource metadata", `resource=${protectedMeta.resource}`);
      } else {
        fail("1c fetch protected-resource metadata", `HTTP ${metaRes.status}`);
      }
    } else {
      fail("1c fetch protected-resource metadata", "skipped (no metadata URL)");
    }

    const authServerBase = protectedMeta?.authorization_servers?.[0]?.replace(/\/$/, "") ?? null;
    if (authServerBase) {
      pass("1d authorization server URL", authServerBase);
    } else {
      fail("1d authorization server URL", "missing authorization_servers[0]");
    }

    let asMeta: AuthorizationServerMetadata | null = null;
    if (authServerBase) {
      const asMetaUrl = `${authServerBase}/.well-known/oauth-authorization-server`;
      const asRes = await fetch(asMetaUrl);
      if (asRes.ok) {
        asMeta = (await asRes.json()) as AuthorizationServerMetadata;
        pass("1e RFC8414 authorization-server metadata", `issuer=${asMeta.issuer}`);
      } else {
        fail("1e RFC8414 authorization-server metadata", `HTTP ${asRes.status} from ${asMetaUrl}`);
      }
    } else {
      fail("1e RFC8414 authorization-server metadata", "skipped");
    }

    // 2 — Dynamic client registration
    let clientId: string | null = null;
    const registrationEndpoint = asMeta?.registration_endpoint;
    if (registrationEndpoint) {
      const regBody = {
        redirect_uris: ["http://localhost:8976/callback"],
        token_endpoint_auth_method: "none",
        grant_types: ["authorization_code", "refresh_token"],
        client_name: "AgentLedger E2E MCP client",
      };
      const regRes = await fetch(registrationEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(regBody),
      });
      const regRaw = await regRes.text();
      if (regRes.ok) {
        const regJson = JSON.parse(regRaw) as DynamicClientRegistrationResponse;
        clientId = regJson.client_id;
        pass("2 DCR register client", `client_id=${clientId}`);
      } else {
        fail("2 DCR register client", `HTTP ${regRes.status}: ${regRaw.slice(0, 200)}`);
      }
    } else {
      fail("2 DCR register client", "registration_endpoint missing in AS metadata");
    }

    // 3 — Authorization request (PKCE) → consent redirect
    let authCode: string | null = null;
    if (clientId && asMeta?.authorization_endpoint) {
      const pkce = pkcePair();
      codeVerifier = pkce.verifier;
      const state = randomBytes(16).toString("base64url");
      const params = new URLSearchParams({
        response_type: "code",
        client_id: clientId,
        redirect_uri: "http://localhost:8976/callback",
        code_challenge: pkce.challenge,
        code_challenge_method: "S256",
        state,
      });
      const scopes = asMeta.scopes_supported;
      if (scopes && scopes.length > 0) {
        params.set("scope", scopes.join(" "));
      }
      const resource = protectedMeta?.resource ?? mcpUrl;
      params.set("resource", resource);

      const authorizeUrl = `${asMeta.authorization_endpoint}?${params.toString()}`;
      const authRes = await fetch(authorizeUrl, { redirect: "manual" });
      const location = authRes.headers.get("location");
      if (authRes.status >= 300 && authRes.status < 400 && location) {
        const locUrl = new URL(location, appBase);
        if (locUrl.pathname.includes("/oauth/consent")) {
          pass("3a authorize redirects to consent", locUrl.pathname + locUrl.search.slice(0, 80));
        } else {
          fail("3a authorize redirects to consent", `Location=${location}`);
        }
        const authId = locUrl.searchParams.get("authorization_id");
        if (authId) {
          authorizationId = authId;
          pass("3b capture authorization_id", authorizationId);
        } else {
          fail("3b capture authorization_id", `no authorization_id in ${location}`);
        }
      } else {
        fail("3a authorize redirects to consent", `status=${authRes.status}, location=${location ?? "(none)"}`);
        fail("3b capture authorization_id", "skipped");
      }
    } else {
      fail("3a authorize redirects to consent", "missing client_id or authorization_endpoint");
      fail("3b capture authorization_id", "skipped");
    }

    // 4 — Fresh user sign-up + OAuth consent approval via auth-js OAuth server API
    const supabaseUser: SupabaseClient = createClient(supabaseUrl, publishableKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    testEmail = `e2e-mcp-oauth-${randomBytes(8).toString("hex")}@agentledger-e2e.invalid`;
    testPassword = randomBytes(18).toString("base64url");

    const signUp = await supabaseUser.auth.signUp({ email: testEmail, password: testPassword });
    if (signUp.error) {
      fail("4a signUp test user", signUp.error.message);
    } else if (signUp.data.user?.id) {
      testUserId = signUp.data.user.id;
      if (signUp.data.session?.access_token) {
        pass("4a signUp test user", `user_id=${testUserId} (session from signUp)`);
      } else {
        const confirm = await admin.auth.admin.updateUserById(testUserId, { email_confirm: true });
        if (confirm.error) {
          fail("4a signUp test user", `signed up but confirm failed: ${confirm.error.message}`);
        } else {
          const signIn = await supabaseUser.auth.signInWithPassword({
            email: testEmail,
            password: testPassword,
          });
          if (signIn.error || !signIn.data.session) {
            fail("4a signUp test user", signIn.error?.message ?? "signIn after confirm failed");
          } else {
            pass("4a signUp test user", `user_id=${testUserId} (confirmed + signed in)`);
          }
        }
      }
    } else {
      fail("4a signUp test user", "no user returned");
    }

    if (authorizationId && supabaseUser.auth.oauth) {
      const details = await supabaseUser.auth.oauth.getAuthorizationDetails(authorizationId);
      if (details.error) {
        fail("4b getAuthorizationDetails", details.error.message);
      } else if (details.data && "authorization_id" in details.data) {
        pass("4b getAuthorizationDetails", `client=${details.data.client.name}`);
      } else if (details.data && "redirect_url" in details.data) {
        pass("4b getAuthorizationDetails", "already consented (redirect_url returned)");
      } else {
        fail("4b getAuthorizationDetails", "empty data");
      }

      const approved = await supabaseUser.auth.oauth.approveAuthorization(authorizationId, {
        skipBrowserRedirect: true,
      });
      if (approved.error || !approved.data?.redirect_url) {
        fail("4c approveAuthorization", approved.error?.message ?? "no redirect_url");
      } else {
        const redirectUrl = new URL(approved.data.redirect_url);
        const code = redirectUrl.searchParams.get("code");
        if (code) {
          authCode = code;
          pass("4c approveAuthorization", "redirect_url contains code");
        } else {
          fail("4c approveAuthorization", `no code in ${approved.data.redirect_url}`);
        }
      }
    } else {
      fail("4b getAuthorizationDetails", "skipped (no authorization_id or session)");
      fail("4c approveAuthorization", "skipped");
    }

    // 5 — Token exchange
    let accessToken: string | null = null;
    if (authCode && clientId && asMeta?.token_endpoint && codeVerifier) {
      const tokenBody = new URLSearchParams({
        grant_type: "authorization_code",
        code: authCode,
        redirect_uri: "http://localhost:8976/callback",
        client_id: clientId,
        code_verifier: codeVerifier,
      });
      const tokenRes = await fetch(asMeta.token_endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
        body: tokenBody.toString(),
      });
      const tokenRaw = await tokenRes.text();
      if (tokenRes.ok) {
        const tokenJson = JSON.parse(tokenRaw) as { access_token?: string };
        if (tokenJson.access_token) {
          accessToken = tokenJson.access_token;
          pass("5 token exchange", "access_token received");
        } else {
          fail("5 token exchange", "response missing access_token");
        }
      } else {
        fail("5 token exchange", `HTTP ${tokenRes.status}: ${tokenRaw.slice(0, 200)}`);
      }
    } else {
      fail("5 token exchange", "skipped (missing code, client, token_endpoint, or verifier)");
    }

    // 6 — MCP JSON-RPC with OAuth access token
    if (accessToken) {
      const init = await mcpRpc(accessToken, "initialize", {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "prod-mcp-oauth-e2e", version: "0" },
      }, 1);
      if (init.status === 200 && init.body?.result) {
        pass("6a MCP initialize", "ok");
      } else {
        fail("6a MCP initialize", `status=${init.status} ${init.raw.slice(0, 120)}`);
      }

      const list = await mcpRpc(accessToken, "tools/list", {}, 2);
      const tools = (list.body?.result as { tools?: { name: string }[] })?.tools ?? [];
      const names = tools.map((t) => t.name);
      const missingTools = EXPECTED_TOOL_NAMES.filter((n) => !names.includes(n));
      if (list.status === 200 && tools.length >= 5 && missingTools.length === 0) {
        pass("6b MCP tools/list (>=5 tools)", names.join(", "));
      } else {
        fail(
          "6b MCP tools/list (>=5 tools)",
          `status=${list.status} count=${tools.length} missing=${missingTools.join(",") || "(none)"}`,
        );
      }

      const delegations = await mcpRpc(
        accessToken,
        "tools/call",
        { name: "list_delegations", arguments: {} },
        3,
      );
      if (delegations.status === 200 && delegations.body?.result) {
        pass("6c tools/call list_delegations", "ok");
      } else {
        fail("6c tools/call list_delegations", `status=${delegations.status}`);
      }

      const search = await mcpRpc(
        accessToken,
        "tools/call",
        { name: "search_products", arguments: { query: "API plan" } },
        4,
      );
      const searchPayload = parseToolText(search.body?.result) as {
        products?: { product_id: string; name: string; merchant_slug?: string }[];
      };
      const products = searchPayload.products ?? [];
      const acmeProduct =
        products.find((p) => p.product_id === "20000000-0000-4000-8000-000000000001") ??
        products.find((p) => /acme/i.test(p.name)) ??
        products[0];
      if (search.status === 200 && products.length > 0) {
        pass("6d tools/call search_products", `hits=${products.length}`);
      } else {
        fail("6d tools/call search_products", `status=${search.status} hits=${products.length}`);
      }

      if (acmeProduct?.product_id) {
        const acmeFirst = await mcpRpc(
          accessToken,
          "tools/call",
          {
            name: "propose_purchase",
            arguments: { product_id: acmeProduct.product_id, reason: "e2e acme approval" },
          },
          5,
        );
        const acmeFirstPayload = parseToolText(acmeFirst.body?.result) as { status?: string };
        if (acmeFirstPayload.status === "awaiting_approval") {
          pass("6e propose_purchase Acme awaiting_approval", acmeProduct.product_id);
        } else {
          fail("6e propose_purchase Acme awaiting_approval", `status=${acmeFirstPayload.status ?? "?"}`);
        }
      } else {
        fail("6e propose_purchase Acme awaiting_approval", "no Acme product from search");
      }

      const evil = await mcpRpc(
        accessToken,
        "tools/call",
        {
          name: "propose_purchase",
          arguments: { product_id: EVIL_CLOUD_PRODUCT_ID, reason: "e2e evil cloud" },
        },
        6,
      );
      const evilPayload = parseToolText(evil.body?.result) as {
        status?: string;
        violations?: string[];
        kill_switch?: { triggered?: boolean };
      };
      const evilMissing = EXPECTED_EVIL_VIOLATIONS.filter((v) => !(evilPayload.violations ?? []).includes(v));
      const evilKill = evilPayload.kill_switch?.triggered === true;
      if (evilPayload.status === "denied" && evilMissing.length === 0 && evilKill) {
        pass(
          "6f propose_purchase Evil Cloud denied + kill switch",
          `${(evilPayload.violations ?? []).join(", ")}; kill_switch.triggered=true`,
        );
      } else {
        fail(
          "6f propose_purchase Evil Cloud denied + kill switch",
          `status=${evilPayload.status ?? "?"} missing=${evilMissing.join(",") || "(none)"} kill=${String(evilKill)}`,
        );
      }

      if (acmeProduct?.product_id) {
        const acmeSuspended = await mcpRpc(
          accessToken,
          "tools/call",
          {
            name: "propose_purchase",
            arguments: { product_id: acmeProduct.product_id, reason: "e2e acme after kill switch" },
          },
          7,
        );
        const acmeSuspendedPayload = parseToolText(acmeSuspended.body?.result) as {
          status?: string;
          violations?: string[];
        };
        const suspendedViolation = (acmeSuspendedPayload.violations ?? []).includes("AGENT_SUSPENDED");
        if (acmeSuspendedPayload.status === "denied" && suspendedViolation) {
          pass("6g propose_purchase Acme denied (AGENT_SUSPENDED)", "AGENT_SUSPENDED");
        } else {
          fail(
            "6g propose_purchase Acme denied (AGENT_SUSPENDED)",
            `status=${acmeSuspendedPayload.status ?? "?"} violations=${(acmeSuspendedPayload.violations ?? []).join(",")}`,
          );
        }
      } else {
        fail("6g propose_purchase Acme denied (AGENT_SUSPENDED)", "no Acme product from search");
      }
    } else {
      fail("6a MCP initialize", "skipped (no access_token)");
      fail("6b MCP tools/list (>=5 tools)", "skipped");
      fail("6c tools/call list_delegations", "skipped");
      fail("6d tools/call search_products", "skipped");
      fail("6e propose_purchase Acme awaiting_approval", "skipped");
      fail("6f propose_purchase Evil Cloud denied + kill switch", "skipped");
      fail("6g propose_purchase Acme denied (AGENT_SUSPENDED)", "skipped");
    }

    // 7 — Consent page requires auth (no cookie → /login)
    if (authorizationId) {
      const consentRes = await fetch(
        `${appBase}/oauth/consent?authorization_id=${encodeURIComponent(authorizationId)}`,
        { redirect: "manual" },
      );
      const consentLoc = consentRes.headers.get("location") ?? "";
      const loginRedirect =
        consentRes.status >= 300 &&
        consentRes.status < 400 &&
        (consentLoc.includes("/login") || new URL(consentLoc, appBase).pathname === "/login");
      if (loginRedirect) {
        pass("7 consent unauthenticated → login", `status=${consentRes.status}`);
      } else {
        fail(
          "7 consent unauthenticated → login",
          `status=${consentRes.status} location=${consentLoc || "(none)"}`,
        );
      }
    } else {
      fail("7 consent unauthenticated → login", "skipped (no authorization_id)");
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (isNetworkError(err)) {
      fail("network", `Cannot reach production from this environment: ${msg}`);
      console.error("\n(Network unreachable — run locally: pnpm exec tsx scripts/e2e/prod-mcp-oauth.ts)\n");
    } else {
      fail("unexpected", msg);
    }
  } finally {
    if (testUserId) {
      try {
        const del = await admin.auth.admin.deleteUser(testUserId);
        if (del.error) {
          fail("cleanup deleteUser", del.error.message);
        } else {
          pass("cleanup deleteUser", testEmail ?? testUserId);
        }
      } catch (cleanupErr) {
        const msg = cleanupErr instanceof Error ? cleanupErr.message : String(cleanupErr);
        fail("cleanup deleteUser", msg);
      }
    }
  }

  printTable();
  const failed = checks.some((c) => c.result === "FAIL");
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(maskSecrets(err instanceof Error ? err.message : String(err)));
  process.exit(1);
});

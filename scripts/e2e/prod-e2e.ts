/**
 * Production end-to-end test for AgentLedger (https://agentledger-cyan.vercel.app).
 * Run: pnpm exec tsx scripts/e2e/prod-e2e.ts
 */
import { createClient, type Session, type SupabaseClient } from "@supabase/supabase-js";
import { createChunks, stringToBase64URL } from "@supabase/ssr";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { performance } from "node:perf_hooks";

const DEMO_PROMPT =
  "Find me the cheapest API plan that gives me at least 100,000 requests for under $20 and buy one month. Do not start a subscription.";

const SECRET_PATTERNS: RegExp[] = [
  /sk_(?:test|live)_[A-Za-z0-9]+/g,
  /rk_(?:test|live)_[A-Za-z0-9]+/g,
  /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,
  /sb_[a-z]+-auth-token[^;\s]*/gi,
];

function loadEnvLocal(): void {
  const path = resolve(process.cwd(), ".env.local");
  if (!existsSync(path)) return;
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
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

function maskSecrets(text: string): string {
  let out = text;
  for (const re of SECRET_PATTERNS) {
    out = out.replace(re, "[REDACTED]");
  }
  return out;
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env: ${name}`);
  return v;
}

function projectRefFromSupabaseUrl(url: string): string {
  const host = new URL(url).hostname;
  return host.split(".")[0];
}

function authCookieHeader(supabaseUrl: string, session: Session): string {
  const storageKey = `sb-${projectRefFromSupabaseUrl(supabaseUrl)}-auth-token`;
  const payload = JSON.stringify(session);
  const encoded = `base64-${stringToBase64URL(payload)}`;
  const chunks = createChunks(storageKey, encoded);
  return chunks.map((c) => `${c.name}=${c.value}`).join("; ");
}

type Check = { name: string; ok: boolean; detail?: string };

const checks: Check[] = [];
const latenciesMs: number[] = [];

function record(name: string, ok: boolean, detail?: string): void {
  checks.push({ name, ok, detail: detail ? maskSecrets(detail) : undefined });
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function asString(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

function asNumber(v: unknown): number | undefined {
  return typeof v === "number" ? v : undefined;
}

function percentile50(sorted: number[]): number {
  if (sorted.length === 0) return 0;
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid];
  return (sorted[mid - 1] + sorted[mid]) / 2;
}

interface E2EUser {
  id: string;
  email: string;
  cookie: string;
  label: string;
}

interface DelegationRow {
  id: string;
  max_amount_cents: number;
  daily_limit_cents: number;
  approval_threshold_cents: number;
  allow_recurring: boolean;
  allowed_merchants: string[];
  status: "active" | "disabled";
  min_trust_score: number;
  trusted_domain_overrides: string[];
  price_anomaly_deny_threshold: number;
  price_anomaly_review_threshold: number;
  injection_kill_threshold: number;
  kill_switch_enabled: boolean;
  require_verified_merchant: boolean;
  allowed_domains: string[];
}

function delegationPatchBody(row: DelegationRow, overrides: Partial<DelegationRow>): Record<string, unknown> {
  const merged = { ...row, ...overrides };
  return {
    delegation_id: merged.id,
    max_amount_cents: merged.max_amount_cents,
    daily_limit_cents: merged.daily_limit_cents,
    approval_threshold_cents: merged.approval_threshold_cents,
    allow_recurring: merged.allow_recurring,
    allowed_merchants: merged.allowed_merchants,
    status: merged.status,
    min_trust_score: merged.min_trust_score,
    trusted_domain_overrides: merged.trusted_domain_overrides,
    price_anomaly_deny_threshold: merged.price_anomaly_deny_threshold,
    price_anomaly_review_threshold: merged.price_anomaly_review_threshold,
    injection_kill_threshold: merged.injection_kill_threshold,
    kill_switch_enabled: merged.kill_switch_enabled,
    require_verified_merchant: merged.require_verified_merchant,
    allowed_domains: merged.allowed_domains,
  };
}

async function timedFetch(url: string, init?: RequestInit): Promise<Response> {
  const start = performance.now();
  try {
    return await fetch(url, init);
  } finally {
    latenciesMs.push(performance.now() - start);
  }
}

function appFetch(baseUrl: string, path: string, cookie: string | null, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers);
  if (cookie) headers.set("Cookie", cookie);
  if (init?.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  return timedFetch(`${baseUrl}${path}`, { ...init, headers });
}

async function readJson(res: Response): Promise<unknown> {
  const text = await res.text();
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { _raw: text.slice(0, 500) };
  }
}

async function createE2EUser(
  authClient: SupabaseClient,
  supabaseUrl: string,
  label: string,
): Promise<E2EUser> {
  const email = `e2e+${randomUUID()}@agentledger-e2e.dev`;
  const password = `E2e-${randomUUID()}-Pw!`;
  const { data: signUpData, error: signUpError } = await authClient.auth.signUp({
    email,
    password,
    options: { data: { display_name: `E2E ${label}` } },
  });
  if (signUpError) throw new Error(`signUp failed (${label}): ${signUpError.message}`);

  let session = signUpData.session;
  if (!session) {
    const { data: signInData, error: signInError } = await authClient.auth.signInWithPassword({
      email,
      password,
    });
    if (signInError || !signInData.session) {
      throw new Error(`signIn failed (${label}): ${signInError?.message ?? "no session"}`);
    }
    session = signInData.session;
  }
  const userId = session.user.id;
  return {
    id: userId,
    email,
    cookie: authCookieHeader(supabaseUrl, session),
    label,
  };
}

async function getAgentIdForOwner(service: SupabaseClient, ownerId: string): Promise<string | null> {
  const { data, error } = await service
    .from("agents")
    .select("id")
    .eq("owner_id", ownerId)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`agent lookup: ${error.message}`);
  return data?.id ?? null;
}

async function isAgentSuspended(
  service: SupabaseClient,
  ownerId: string,
): Promise<{ agentId: string | null; suspended: boolean }> {
  const agentId = await getAgentIdForOwner(service, ownerId);
  if (!agentId) return { agentId: null, suspended: false };
  const { data, error } = await service.from("agents").select("status").eq("id", agentId).maybeSingle();
  if (error) throw new Error(`agent status: ${error.message}`);
  return { agentId, suspended: data?.status === "suspended" };
}

function firstAttackStepResult(attackJson: unknown): Record<string, unknown> | null {
  if (!isRecord(attackJson) || !Array.isArray(attackJson.steps) || !attackJson.steps[0]) return null;
  const step0 = attackJson.steps[0];
  if (!isRecord(step0) || !isRecord(step0.result)) return null;
  return step0.result;
}

async function afterEvilCloudKillSwitch(
  baseUrl: string,
  cookie: string,
  service: SupabaseClient,
  principalId: string,
  scenarioLabel: string,
): Promise<void> {
  const { agentId, suspended } = await isAgentSuspended(service, principalId);
  record("kill switch triggered", suspended, suspended ? scenarioLabel : "agent not suspended");

  if (!suspended) {
    record(`suspended: replay denied (${scenarioLabel})`, false, "agent not suspended");
    record(`POST reenable after ${scenarioLabel}`, false, "skipped");
    return;
  }

  const replayRes = await appFetch(baseUrl, "/api/attack/replay", cookie, { method: "POST" });
  const replayJson = await readJson(replayRes);
  const replayStep = firstAttackStepResult(replayJson);
  const replayViolations =
    replayStep && Array.isArray(replayStep.violations)
      ? replayStep.violations.filter((v): v is string => typeof v === "string")
      : [];
  const replayDenied =
    replayViolations.includes("AGENT_SUSPENDED") || replayStep?.status === "denied";
  record(
    `suspended: replay denied (${scenarioLabel})`,
    replayDenied,
    asString(replayStep?.status) ?? "no step result",
  );

  if (!agentId) {
    record(`POST reenable after ${scenarioLabel}`, false, "no agent id");
    return;
  }
  const reRes = await appFetch(baseUrl, `/api/agents/${agentId}/reenable`, cookie, { method: "POST" });
  record(`POST reenable after ${scenarioLabel}`, reRes.status === 200, `status=${reRes.status}`);
}

async function getDelegationForPrincipal(service: SupabaseClient, principalId: string): Promise<DelegationRow | null> {
  const { data, error } = await service
    .from("delegations")
    .select(
      "id, max_amount_cents, daily_limit_cents, approval_threshold_cents, allow_recurring, allowed_merchants, status, min_trust_score, trusted_domain_overrides, price_anomaly_deny_threshold, price_anomaly_review_threshold, injection_kill_threshold, kill_switch_enabled, require_verified_merchant, allowed_domains",
    )
    .eq("principal_id", principalId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`delegation lookup: ${error.message}`);
  return (data as DelegationRow | null) ?? null;
}

async function stripeGet(secretKey: string, path: string, query?: Record<string, string>): Promise<unknown> {
  const url = new URL(`https://api.stripe.com/v1${path}`);
  if (query) {
    for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  }
  const res = await timedFetch(url.toString(), {
    headers: { Authorization: `Bearer ${secretKey}` },
  });
  return readJson(res);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function stripePaymentIntentCountForIntent(
  stripeKey: string,
  intentId: string,
): Promise<{ count: number; source: "search" | "list-fallback" }> {
  const searchQuery = `metadata['agentledger_intent_id']:'${intentId}'`;
  const pollIntervalMs = 5000;
  const pollDeadlineMs = 90_000;
  const started = performance.now();

  while (performance.now() - started < pollDeadlineMs) {
    const search = await stripeGet(stripeKey, "/payment_intents/search", { query: searchQuery });
    const searchData = isRecord(search) && Array.isArray(search.data) ? search.data : null;
    const n = searchData?.length ?? 0;
    if (n >= 1) {
      return { count: n, source: "search" };
    }
    await sleep(pollIntervalMs);
  }

  const list = await stripeGet(stripeKey, "/payment_intents", { limit: "20" });
  const listData = isRecord(list) && Array.isArray(list.data) ? list.data : [];
  let count = 0;
  for (const item of listData) {
    if (!isRecord(item) || !isRecord(item.metadata)) continue;
    if (item.metadata.agentledger_intent_id === intentId) count += 1;
  }
  return { count, source: "list-fallback" };
}

async function main(): Promise<void> {
  loadEnvLocal();

  const baseUrl = (process.env.BASE_URL ?? "https://agentledger-cyan.vercel.app").replace(/\/$/, "");
  const supabaseUrl = requireEnv("SUPABASE_HOSTED_URL");
  const publishableKey = requireEnv("SUPABASE_HOSTED_PUBLISHABLE_KEY");
  const serviceKey = requireEnv("SUPABASE_HOSTED_API_KEY");
  const stripeKey = requireEnv("STRIPE_SECRET_KEY");

  const authClient = createClient(supabaseUrl, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const service = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let userA: E2EUser | null = null;
  let userB: E2EUser | null = null;
  let networkFailed = false;

  const cleanup = async (): Promise<void> => {
    for (const u of [userA, userB]) {
      if (!u) continue;
      const { error } = await service.auth.admin.deleteUser(u.id);
      record(`cleanup delete user ${u.label}`, !error, error?.message);
    }
  };

  try {
    record("env SUPABASE_HOSTED_URL", Boolean(supabaseUrl.startsWith("https://")));
    record("env STRIPE test key", stripeKey.startsWith("sk_test_") || stripeKey.startsWith("rk_test_"));

    userA = await createE2EUser(authClient, supabaseUrl, "A");
    userB = await createE2EUser(authClient, supabaseUrl, "B");
    record("create user A", Boolean(userA.id));
    record("create user B", Boolean(userB.id));

    const cookieA = userA.cookie;
    const cookieB = userB.cookie;
    const principalA = userA.id;

    const dashRes = await appFetch(baseUrl, "/dashboard", cookieA);
    const dashHtml = await dashRes.text();
    record("GET /dashboard → 200", dashRes.status === 200, `status=${dashRes.status}`);
    record('GET /dashboard contains "Give agents"', dashHtml.includes("Give agents"));

    const pages = [
      "/dashboard/playground",
      "/dashboard/transactions",
      "/dashboard/delegations",
      "/dashboard/audit",
      "/dashboard/attack-lab",
      "/dashboard/registry",
    ];
    for (const path of pages) {
      const res = await appFetch(baseUrl, path, cookieA);
      record(`GET ${path} → 200`, res.status === 200, `status=${res.status}`);
    }

    const unauthPostPaths = [
      "/api/agent/run",
      "/api/attack/prompt-injection",
      `/api/approvals/${randomUUID()}`,
    ];
    for (const path of unauthPostPaths) {
      const res = await appFetch(baseUrl, path, null, {
        method: "POST",
        body: path.includes("agent/run")
          ? JSON.stringify({ prompt: "hello", compromised: false })
          : path.includes("approvals")
            ? JSON.stringify({ decision: "approved" })
            : undefined,
      });
      record(`unauth POST ${path} → 401`, res.status === 401, `status=${res.status}`);
    }
    const auditUnauth = await appFetch(baseUrl, "/api/audit/verify", null);
    record("unauth GET /api/audit/verify → 401", auditUnauth.status === 401, `status=${auditUnauth.status}`);

    const dashUnauth = await timedFetch(`${baseUrl}/dashboard`, { redirect: "manual" });
    const dashUnauthLoc = dashUnauth.headers.get("location");
    const dashUnauthLogin =
      (dashUnauth.status === 307 || dashUnauth.status === 308) &&
      Boolean(dashUnauthLoc && new URL(dashUnauthLoc, baseUrl).pathname === "/login");
    record(
      "unauth GET /dashboard → redirect",
      dashUnauthLogin,
      `status=${dashUnauth.status} location=${dashUnauthLoc ?? "(none)"}`,
    );

    const injRes = await appFetch(baseUrl, "/api/attack/prompt-injection", cookieA, { method: "POST" });
    const injJson = await readJson(injRes);
    record("POST prompt-injection → 200", injRes.status === 200, `status=${injRes.status}`);
    let injResult: Record<string, unknown> | null = null;
    if (isRecord(injJson) && Array.isArray(injJson.steps) && injJson.steps[0] && isRecord(injJson.steps[0])) {
      const step0 = injJson.steps[0];
      if (isRecord(step0.result)) injResult = step0.result;
    }
    const injViolations =
      injResult && Array.isArray(injResult.violations)
        ? injResult.violations.filter((v): v is string => typeof v === "string")
        : [];
    record("prompt-injection status denied", injResult?.status === "denied", asString(injResult?.status));
    for (const code of ["TRANSACTION_LIMIT_EXCEEDED", "RECURRING_NOT_ALLOWED", "MERCHANT_NOT_ALLOWED"] as const) {
      record(`prompt-injection violation ${code}`, injViolations.includes(code));
    }
    await afterEvilCloudKillSwitch(baseUrl, cookieA, service, principalA, "prompt-injection");

    const tamperRes = await appFetch(baseUrl, "/api/attack/parameter-tampering", cookieA, { method: "POST" });
    const tamperJson = await readJson(tamperRes);
    record("POST parameter-tampering → 200", tamperRes.status === 200, `status=${tamperRes.status}`);
    let tamperResult: Record<string, unknown> | null = null;
    if (isRecord(tamperJson) && Array.isArray(tamperJson.steps) && tamperJson.steps[0] && isRecord(tamperJson.steps[0])) {
      const step0 = tamperJson.steps[0];
      if (isRecord(step0.result)) tamperResult = step0.result;
    }
    const authTerms = isRecord(tamperResult?.authoritative) ? tamperResult.authoritative : null;
    record(
      "parameter-tampering authoritative 50000",
      asNumber(authTerms?.amount_cents) === 50000,
      `amount=${String(authTerms?.amount_cents)}`,
    );
    record("parameter-tampering denied", tamperResult?.status === "denied", asString(tamperResult?.status));
    await afterEvilCloudKillSwitch(baseUrl, cookieA, service, principalA, "parameter-tampering");

    let intentId: string | undefined;
    let approvalId: string | undefined;
    const agentRunRes = await appFetch(baseUrl, "/api/agent/run", cookieA, {
      method: "POST",
      body: JSON.stringify({ prompt: DEMO_PROMPT, compromised: false }),
      signal: AbortSignal.timeout(120_000),
    });
    record("POST /api/agent/run → 200", agentRunRes.status === 200, `status=${agentRunRes.status}`);
    if (agentRunRes.ok && agentRunRes.body) {
      const reader = agentRunRes.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let proposeOutput: Record<string, unknown> | null = null;
      let agentError: string | undefined;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          let parsed: unknown;
          try {
            parsed = JSON.parse(line) as unknown;
          } catch {
            continue;
          }
          if (!isRecord(parsed)) continue;
          if (parsed.type === "error" && typeof parsed.message === "string") agentError = parsed.message;
          if (parsed.type === "tool_result" && parsed.tool === "propose_purchase" && isRecord(parsed.output)) {
            proposeOutput = parsed.output;
          }
        }
      }
      if (proposeOutput?.status === "awaiting_approval") {
        intentId = asString(proposeOutput.intent_id);
        approvalId = asString(proposeOutput.approval_id);
        record("agent propose_purchase awaiting_approval", true);
      } else {
        const reason = agentError ?? asString(proposeOutput?.message) ?? asString(proposeOutput?.status) ?? "no propose_purchase";
        record("agent propose_purchase awaiting_approval", false, reason);
      }
    }

    if (approvalId) {
      const crossRes = await appFetch(baseUrl, `/api/approvals/${approvalId}`, cookieB, {
        method: "POST",
        body: JSON.stringify({ decision: "approved" }),
      });
      record("cross-user approval → 403", crossRes.status === 403, `status=${crossRes.status}`);
      const { data: approvalRow } = await service
        .from("approvals")
        .select("status")
        .eq("id", approvalId)
        .maybeSingle();
      record("approval still pending after cross-user", approvalRow?.status === "pending", `status=${String(approvalRow?.status)}`);
    } else {
      record("cross-user approval → 403", false, "no approval_id from agent run");
      record("approval still pending after cross-user", false, "skipped");
    }

    let stripePiId: string | undefined;
    if (approvalId) {
      const approveRes = await appFetch(baseUrl, `/api/approvals/${approvalId}`, cookieA, {
        method: "POST",
        body: JSON.stringify({ decision: "approved", reason: "E2E approve" }),
      });
      const approveJson = await readJson(approveRes);
      record("user A approve → 200", approveRes.status === 200, `status=${approveRes.status}`);
      const execution = isRecord(approveJson) && isRecord(approveJson.execution) ? approveJson.execution : null;
      record("execution status executed", execution?.status === "executed", asString(execution?.status));
      stripePiId = asString(execution?.stripe_payment_intent_id);
      record("stripe_payment_intent_id pi_*", Boolean(stripePiId?.startsWith("pi_")), stripePiId ?? "missing");
      if (!intentId && execution) intentId = asString(execution.intent_id);
    } else {
      record("user A approve → 200", false, "no approval_id");
      record("execution status executed", false, "skipped");
      record("stripe_payment_intent_id pi_*", false, "skipped");
    }

    if (stripePiId && intentId) {
      const pi = await stripeGet(stripeKey, `/payment_intents/${stripePiId}`);
      const piRec = isRecord(pi) ? pi : null;
      record("Stripe PI status succeeded", piRec?.status === "succeeded", asString(piRec?.status));
      record("Stripe PI amount 1500", piRec?.amount === 1500, `amount=${String(piRec?.amount)}`);
      record("Stripe PI livemode false", piRec?.livemode === false);
      const meta = isRecord(piRec?.metadata) ? piRec.metadata : null;
      record(
        "Stripe metadata agentledger_intent_id",
        meta?.agentledger_intent_id === intentId,
        `meta=${String(meta?.agentledger_intent_id)} intent=${intentId}`,
      );
    } else {
      record("Stripe PI status succeeded", false, "skipped");
      record("Stripe PI amount 1500", false, "skipped");
      record("Stripe PI livemode false", false, "skipped");
      record("Stripe metadata agentledger_intent_id", false, "skipped");
    }

    if (intentId) {
      const replayResults = await Promise.all(
        Array.from({ length: 5 }, () =>
          appFetch(baseUrl, `/api/actions/${intentId}/execute`, cookieA, { method: "POST" }).then(async (r) => ({
            status: r.status,
            body: await readJson(r),
          })),
        ),
      );
      const allDuplicate = replayResults.every(
        (r) => r.status === 200 && isRecord(r.body) && r.body.status === "duplicate" && r.body.additional_charge_cents === 0,
      );
      record("5× execute all duplicate", allDuplicate);
      const { count, error: execCountErr } = await service
        .from("executions")
        .select("id", { count: "exact", head: true })
        .eq("intent_id", intentId);
      record("executions count == 1", !execCountErr && count === 1, `count=${String(count)}`);
      const { count: stripePiCount, source: stripePiSource } = await stripePaymentIntentCountForIntent(
        stripeKey,
        intentId,
      );
      record(
        "Stripe search PI count == 1",
        stripePiCount === 1,
        `count=${String(stripePiCount)} via=${stripePiSource}`,
      );
    } else {
      record("5× execute all duplicate", false, "no intent_id");
      record("executions count == 1", false, "skipped");
      record("Stripe search PI count == 1", false, "skipped");
    }

    const auditRes = await appFetch(baseUrl, "/api/audit/verify", cookieA);
    const auditJson = await readJson(auditRes);
    record("GET /api/audit/verify → 200", auditRes.status === 200, `status=${auditRes.status}`);
    if (isRecord(auditJson)) {
      record("audit valid true", auditJson.valid === true);
      const verifiedCount = asNumber(auditJson.verifiedCount) ?? 0;
      record("audit verifiedCount > 10", verifiedCount > 10, `verifiedCount=${verifiedCount}`);
    } else {
      record("audit valid true", false);
      record("audit verifiedCount > 10", false);
    }

    const replayAttackRes = await appFetch(baseUrl, "/api/attack/replay", cookieA, { method: "POST" });
    const replayAttackJson = await readJson(replayAttackRes);
    record("POST /api/attack/replay → 200", replayAttackRes.status === 200, `status=${replayAttackRes.status}`);
    if (isRecord(replayAttackJson)) {
      record(
        "replay executions_for_intent 1",
        replayAttackJson.executions_for_intent === 1,
        `count=${String(replayAttackJson.executions_for_intent)}`,
      );
      record(
        "replay additional_charge_cents 0",
        replayAttackJson.additional_charge_cents === 0,
        `cents=${String(replayAttackJson.additional_charge_cents)}`,
      );
    } else {
      record("replay executions_for_intent 1", false);
      record("replay additional_charge_cents 0", false);
    }

    const delegation = await getDelegationForPrincipal(service, principalA);
    if (delegation) {
      const patchLow = await appFetch(baseUrl, "/api/delegations", cookieA, {
        method: "PATCH",
        body: JSON.stringify(delegationPatchBody(delegation, { max_amount_cents: 1000 })),
      });
      record("PATCH delegation max 1000 → 200", patchLow.status === 200, `status=${patchLow.status}`);
      const { data: afterLow } = await service
        .from("delegations")
        .select("max_amount_cents")
        .eq("id", delegation.id)
        .maybeSingle();
      record("DB max_amount_cents 1000", afterLow?.max_amount_cents === 1000, `max=${String(afterLow?.max_amount_cents)}`);
      record(
        "$15 (1500¢) exceeds max 1000 enforcement",
        typeof afterLow?.max_amount_cents === "number" && afterLow.max_amount_cents < 1500,
      );
      const patchRestore = await appFetch(baseUrl, "/api/delegations", cookieA, {
        method: "PATCH",
        body: JSON.stringify(delegationPatchBody(delegation, { max_amount_cents: 2000 })),
      });
      record("PATCH delegation restore 2000 → 200", patchRestore.status === 200, `status=${patchRestore.status}`);
    } else {
      record("PATCH delegation max 1000 → 200", false, "no delegation row");
      record("DB max_amount_cents 1000", false, "skipped");
      record("$15 (1500¢) exceeds max 1000 enforcement", false, "skipped");
      record("PATCH delegation restore 2000 → 200", false, "skipped");
    }

    // Stripe → webhook → reconciliation audit row (Stripe delivers asynchronously; poll up to 60s).
    if (stripePiId) {
      let reconciled = false;
      for (let i = 0; i < 12 && !reconciled; i++) {
        const { data } = await service
          .from("audit_events")
          .select("id")
          .eq("principal_id", principalA)
          .contains("event_data", { source: "stripe_webhook", payment_intent_id: stripePiId })
          .limit(1);
        reconciled = (data?.length ?? 0) > 0;
        if (!reconciled) await new Promise((r) => setTimeout(r, 5000));
      }
      record("Stripe webhook reconciled payment (audit source=stripe_webhook)", reconciled, stripePiId);
    } else {
      record("Stripe webhook reconciled payment (audit source=stripe_webhook)", false, "skipped: no PaymentIntent");
    }

    const resetRes = await appFetch(baseUrl, "/api/demo/reset", cookieA, { method: "POST" });
    record("POST /api/demo/reset → 200", resetRes.status === 200, `status=${resetRes.status}`);
    const { count: intentCount, error: intentCountErr } = await service
      .from("action_intents")
      .select("id", { count: "exact", head: true })
      .eq("principal_id", principalA);
    record("intents count 0 after reset", !intentCountErr && intentCount === 0, `count=${String(intentCount)}`);
  } catch (error) {
    networkFailed =
      error instanceof TypeError ||
      (error instanceof Error &&
        /fetch|ENOTFOUND|ECONNREFUSED|ETIMEDOUT|network|certificate/i.test(error.message));
    const msg = error instanceof Error ? error.message : String(error);
    record("run aborted", false, networkFailed ? `network or unreachable: ${msg}` : msg);
  } finally {
    try {
      await cleanup();
    } catch (cleanupError) {
      const msg = cleanupError instanceof Error ? cleanupError.message : String(cleanupError);
      record("cleanup", false, msg);
    }
  }

  const sorted = [...latenciesMs].sort((a, b) => a - b);
  const p50 = Math.round(percentile50(sorted));
  const max = sorted.length ? Math.round(sorted[sorted.length - 1]) : 0;

  console.log("\nAgentLedger production E2E");
  console.log(`BASE_URL: ${baseUrl}`);
  if (networkFailed) {
    console.log("\nNote: sandbox or local run may not reach production; re-run where network to hosted app is available.\n");
  }
  console.log("\n| Check | Result | Detail |");
  console.log("| --- | --- | --- |");
  for (const c of checks) {
    console.log(`| ${c.name} | ${c.ok ? "PASS" : "FAIL"} | ${c.detail ?? ""} |`);
  }
  console.log(`\nLatency (ms): p50=${p50} max=${max} (n=${latenciesMs.length} requests)`);

  const failed = checks.some((c) => !c.ok);
  process.exit(failed ? 1 : 0);
}

void main();

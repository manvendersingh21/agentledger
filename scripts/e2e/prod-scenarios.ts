/**
 * Scenario + Attack Lab E2E (local or hosted).
 * Run: pnpm exec tsx scripts/e2e/prod-scenarios.ts
 */
import { createClient, type Session, type SupabaseClient } from "@supabase/supabase-js";
import { createChunks, stringToBase64URL } from "@supabase/ssr";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { performance } from "node:perf_hooks";

const SCENARIOS = ["home", "diy", "restaurant", "software"] as const;

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

function record(name: string, ok: boolean, detail?: string): void {
  checks.push({ name, ok, detail: detail ? maskSecrets(detail) : undefined });
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function asNumber(v: unknown): number | undefined {
  return typeof v === "number" ? v : undefined;
}

interface E2EUser {
  id: string;
  email: string;
  cookie: string;
}

async function appFetch(baseUrl: string, path: string, cookie: string | null, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers);
  if (cookie) headers.set("Cookie", cookie);
  if (init?.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  return fetch(`${baseUrl}${path}`, { ...init, headers });
}

async function readJson(res: Response): Promise<unknown> {
  const text = await res.text();
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { _raw: text.slice(0, 500) };
  }
}

async function createE2EUser(authClient: SupabaseClient, supabaseUrl: string): Promise<E2EUser> {
  const email = `e2e-scenarios+${randomUUID()}@agentledger-e2e.dev`;
  const password = `E2e-${randomUUID()}-Pw!`;
  const { data: signUpData, error: signUpError } = await authClient.auth.signUp({
    email,
    password,
    options: { data: { display_name: "E2E Scenarios" } },
  });
  if (signUpError) throw new Error(`signUp failed: ${signUpError.message}`);

  let session = signUpData.session;
  if (!session) {
    const { data: signInData, error: signInError } = await authClient.auth.signInWithPassword({ email, password });
    if (signInError || !signInData.session) {
      throw new Error(`signIn failed: ${signInError?.message ?? "no session"}`);
    }
    session = signInData.session;
  }
  return {
    id: session.user.id,
    email,
    cookie: authCookieHeader(supabaseUrl, session),
  };
}

function attackStepResults(attackJson: unknown): Record<string, unknown>[] {
  if (!isRecord(attackJson) || !Array.isArray(attackJson.steps)) return [];
  const out: Record<string, unknown>[] = [];
  for (const step of attackJson.steps) {
    if (!isRecord(step) || !isRecord(step.result)) continue;
    out.push(step.result);
  }
  return out;
}

function attackHasViolation(attackJson: unknown, code: string): boolean {
  for (const r of attackStepResults(attackJson)) {
    const violations = Array.isArray(r.violations) ? r.violations : [];
    if (violations.some((v) => v === code)) return true;
  }
  return false;
}

function attackDenied(attackJson: unknown): boolean {
  return attackStepResults(attackJson).some((r) => r.status === "denied");
}

async function getAgentId(service: SupabaseClient, ownerId: string): Promise<string | null> {
  const { data, error } = await service
    .from("agents")
    .select("id, status")
    .eq("owner_id", ownerId)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data?.id ?? null;
}

async function reenableAgentIfSuspended(baseUrl: string, cookie: string, service: SupabaseClient, ownerId: string): Promise<void> {
  const agentId = await getAgentId(service, ownerId);
  if (!agentId) return;
  const { data } = await service.from("agents").select("status").eq("id", agentId).maybeSingle();
  if (data?.status !== "suspended") return;
  const res = await appFetch(baseUrl, `/api/agents/${agentId}/reenable`, cookie, { method: "POST" });
  record("reenable agent after kill switch", res.status === 200, `status=${res.status}`);
}

async function parseConciergeNdjson(res: Response): Promise<{
  askUser: boolean;
  recommendation: boolean;
  error?: string;
}> {
  if (!res.ok || !res.body) {
    return { askUser: false, recommendation: false, error: `status=${res.status}` };
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let askUser = false;
  let recommendation = false;
  let error: string | undefined;
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
      if (parsed.type === "ask_user") askUser = true;
      if (parsed.type === "error" && typeof parsed.message === "string") error = parsed.message;
      if (parsed.type === "tool_result" && parsed.tool === "propose_purchase") recommendation = true;
      if (parsed.type === "tool_result" && parsed.tool === "search_products") recommendation = true;
      if (parsed.type === "done" && typeof parsed.text === "string" && parsed.text.trim().length > 40) {
        recommendation = true;
      }
    }
  }
  return { askUser, recommendation, error };
}

const PRESET_EXPECTATIONS: Record<
  (typeof SCENARIOS)[number],
  { max: number; daily: number; threshold: number; categories: string[] }
> = {
  home: { max: 15_000, daily: 30_000, threshold: 6_000, categories: ["home_appliance"] },
  diy: { max: 10_000, daily: 20_000, threshold: 5_000, categories: ["diy_tools", "diy_supplies"] },
  restaurant: { max: 12_000, daily: 60_000, threshold: 7_500, categories: ["restaurant_food", "restaurant_supplies"] },
  software: { max: 2_000, daily: 5_000, threshold: 1_000, categories: [] },
};

async function main(): Promise<void> {
  loadEnvLocal();
  const started = performance.now();

  const baseUrl = (process.env.BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
  const supabaseUrl = process.env.SUPABASE_HOSTED_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? requireEnv("SUPABASE_URL");
  const publishableKey =
    process.env.SUPABASE_HOSTED_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? requireEnv("SUPABASE_ANON_KEY");
  const serviceKey = process.env.SUPABASE_HOSTED_API_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY ?? requireEnv("SUPABASE_SERVICE_ROLE_KEY");

  const authClient = createClient(supabaseUrl, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const service = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let user: E2EUser | null = null;

  const cleanup = async (): Promise<void> => {
    if (!user) return;
    const { error } = await service.auth.admin.deleteUser(user.id);
    record("cleanup delete user", !error, error?.message);
  };

  try {
    user = await createE2EUser(authClient, supabaseUrl);
    record("create user", Boolean(user.id));
    const cookie = user.cookie;
    const principalId = user.id;

    const scenariosPage = await appFetch(baseUrl, "/dashboard/scenarios", cookie);
    record("GET /dashboard/scenarios → 200", scenariosPage.status === 200, `status=${scenariosPage.status}`);

    for (const scenario of SCENARIOS) {
      const applyRes = await appFetch(baseUrl, "/api/scenarios/apply", cookie, {
        method: "POST",
        body: JSON.stringify({ scenario }),
      });
      const applyJson = await readJson(applyRes);
      record(`POST apply ${scenario} → 200`, applyRes.status === 200, `status=${applyRes.status}`);
      const delegation = isRecord(applyJson) && isRecord(applyJson.delegation) ? applyJson.delegation : null;
      const exp = PRESET_EXPECTATIONS[scenario];
      record(
        `${scenario} max_amount_cents`,
        asNumber(delegation?.max_amount_cents) === exp.max,
        `max=${String(delegation?.max_amount_cents)}`,
      );
      record(
        `${scenario} approval_threshold_cents`,
        asNumber(delegation?.approval_threshold_cents) === exp.threshold,
        `threshold=${String(delegation?.approval_threshold_cents)}`,
      );
      const allowed = Array.isArray(delegation?.allowed_categories)
        ? (delegation.allowed_categories as string[])
        : [];
      const categoriesOk =
        exp.categories.length === 0
          ? allowed.length === 0
          : exp.categories.every((c) => allowed.includes(c)) && allowed.length === exp.categories.length;
      record(`${scenario} allowed_categories`, categoriesOk, allowed.join(","));

      if (scenario === "restaurant") {
        const simRes = await appFetch(baseUrl, "/api/inventory/simulate", cookie, {
          method: "POST",
          body: JSON.stringify({ seed: 42 }),
        });
        const simJson = await readJson(simRes);
        record("POST inventory/simulate → 200", simRes.status === 200, `status=${simRes.status}`);
        const items = isRecord(simJson) && Array.isArray(simJson.items) ? simJson.items : [];
        record("simulate returns items", items.length >= 1, `count=${items.length}`);

        const restockRes = await appFetch(baseUrl, "/api/inventory/restock", cookie, { method: "POST" });
        const restockJson = await readJson(restockRes);
        record("POST inventory/restock → 200", restockRes.status === 200, `status=${restockRes.status}`);
        const results = isRecord(restockJson) && Array.isArray(restockJson.results) ? restockJson.results : [];
        record("restock returns results", results.length >= 1, `lines=${results.length}`);
      }
    }

    const cryptoRes = await appFetch(baseUrl, "/api/attack/crypto-purchase", cookie, { method: "POST" });
    const cryptoJson = await readJson(cryptoRes);
    record("POST attack/crypto-purchase → 200", cryptoRes.status === 200, `status=${cryptoRes.status}`);
    record("crypto-purchase denied", attackDenied(cryptoJson));
    record("crypto-purchase CATEGORY_BLOCKED", attackHasViolation(cryptoJson, "CATEGORY_BLOCKED"));
    await reenableAgentIfSuspended(baseUrl, cookie, service, principalId);

    await appFetch(baseUrl, "/api/scenarios/apply", cookie, {
      method: "POST",
      body: JSON.stringify({ scenario: "restaurant" }),
    });
    const overRes = await appFetch(baseUrl, "/api/attack/overpriced", cookie, { method: "POST" });
    const overJson = await readJson(overRes);
    record("POST attack/overpriced → 200", overRes.status === 200, `status=${overRes.status}`);
    record("overpriced denied", attackDenied(overJson));
    record("overpriced PRICE_ABOVE_MARKET", attackHasViolation(overJson, "PRICE_ABOVE_MARKET"));

    await appFetch(baseUrl, "/api/scenarios/apply", cookie, {
      method: "POST",
      body: JSON.stringify({ scenario: "software" }),
    });
    const tamperRes = await appFetch(baseUrl, "/api/attack/approval-tamper", cookie, { method: "POST" });
    const tamperJson = await readJson(tamperRes);
    record("POST attack/approval-tamper → 200", tamperRes.status === 200, `status=${tamperRes.status}`);
    record("approval-tamper APPROVAL_HASH_MISMATCH", attackHasViolation(tamperJson, "APPROVAL_HASH_MISMATCH"));

    await appFetch(baseUrl, "/api/scenarios/apply", cookie, {
      method: "POST",
      body: JSON.stringify({ scenario: "home" }),
    });
    const chatRes = await appFetch(baseUrl, "/api/agent/chat", cookie, {
      method: "POST",
      body: JSON.stringify({
        messages: [{ role: "user", content: "I need a quiet fan for a 200 sq ft bedroom. Budget around $60." }],
      }),
      signal: AbortSignal.timeout(120_000),
    });
    if (chatRes.status === 503) {
      record("concierge single turn (ask_user or recommendation)", true, "OPENAI_API_KEY not configured — skipped");
    } else {
      const concierge = await parseConciergeNdjson(chatRes);
      record(
        "concierge single turn (ask_user or recommendation)",
        concierge.askUser || concierge.recommendation,
        concierge.error ?? (concierge.askUser ? "ask_user" : concierge.recommendation ? "recommendation" : "neither"),
      );
      record("concierge chat → 200", chatRes.status === 200, `status=${chatRes.status}`);
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    record("run aborted", false, msg);
  } finally {
    try {
      await cleanup();
    } catch (cleanupError) {
      const msg = cleanupError instanceof Error ? cleanupError.message : String(cleanupError);
      record("cleanup", false, msg);
    }
  }

  const elapsed = Math.round(performance.now() - started);
  console.log("\nAgentLedger scenario E2E");
  console.log(`BASE_URL: ${baseUrl}`);
  console.log(`Elapsed: ${elapsed}ms\n`);
  console.log("| Check | Result | Detail |");
  console.log("| --- | --- | --- |");
  for (const c of checks) {
    console.log(`| ${c.name} | ${c.ok ? "PASS" : "FAIL"} | ${c.detail ?? ""} |`);
  }

  const failed = checks.some((c) => !c.ok);
  process.exit(failed ? 1 : 0);
}

void main();

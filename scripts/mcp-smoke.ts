import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

const EVIL_CLOUD_PRODUCT_ID = "20000000-0000-4000-8000-000000000005";

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

function baseUrl(): string {
  return (process.env.APP_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(
    /\/$/,
    "",
  );
}

type JsonRpcResponse = {
  jsonrpc: string;
  id?: number;
  result?: unknown;
  error?: { code: number; message: string };
};

async function mcpRpc(
  token: string | null,
  method: string,
  params?: unknown,
  id = 1,
): Promise<{ status: number; body: JsonRpcResponse | null; raw: string }> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${baseUrl()}/api/mcp`, {
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

async function toolsCall(token: string, name: string, args: Record<string, unknown>, id: number) {
  return mcpRpc(token, "tools/call", { name, arguments: args }, id);
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

async function main() {
  loadEnvLocal();
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!supabaseUrl || !publishableKey) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY in .env.local");
  }

  console.log("=== MCP smoke (no token) ===");
  const unauth = await mcpRpc(null, "initialize", { capabilities: {} }, 0);
  console.log("status:", unauth.status, "body:", unauth.raw || "(empty)");
  if (unauth.status !== 401) {
    console.error("Expected 401 without token");
    process.exitCode = 1;
  }

  const supabase = createClient(supabaseUrl, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: signIn, error: signInError } = await supabase.auth.signInWithPassword({
    email: "demo@agentledger.dev",
    password: "agentledger-demo",
  });
  if (signInError || !signIn.session?.access_token) {
    throw new Error(`Sign-in failed: ${signInError?.message ?? "no session"}`);
  }
  const token = signIn.session.access_token;
  console.log("\n=== initialize ===");
  const init = await mcpRpc(token, "initialize", { capabilities: {}, clientInfo: { name: "smoke", version: "0" } }, 1);
  console.log(JSON.stringify(init.body, null, 2));

  console.log("\n=== tools/list ===");
  const list = await mcpRpc(token, "tools/list", {}, 2);
  const tools = (list.body?.result as { tools?: { name: string }[] })?.tools ?? [];
  console.log("tools:", tools.map((t) => t.name).join(", "));

  console.log("\n=== list_delegations ===");
  const delegations = await toolsCall(token, "list_delegations", {}, 3);
  console.log(JSON.stringify(parseToolText(delegations.body?.result), null, 2));

  console.log('\n=== search_products("API plan") ===');
  const search = await toolsCall(token, "search_products", { query: "API plan" }, 4);
  const searchPayload = parseToolText(search.body?.result) as { products?: { product_id: string; name: string }[] };
  console.log(JSON.stringify(searchPayload, null, 2));

  console.log("\n=== propose_purchase (Evil Cloud) ===");
  const propose = await toolsCall(
    token,
    "propose_purchase",
    { product_id: EVIL_CLOUD_PRODUCT_ID, reason: "smoke test evil cloud" },
    5,
  );
  const purchase = parseToolText(propose.body?.result) as {
    status?: string;
    violations?: string[];
  };
  console.log(JSON.stringify(purchase, null, 2));

  const violations = purchase.violations ?? [];
  const expected = ["TRANSACTION_LIMIT_EXCEEDED", "RECURRING_NOT_ALLOWED", "MERCHANT_NOT_ALLOWED"];
  const missing = expected.filter((v) => !violations.includes(v));
  if (purchase.status !== "denied" || missing.length > 0) {
    console.error("\nExpected denied with violations:", expected.join(", "));
    console.error("Missing:", missing.join(", ") || "(none)");
    process.exitCode = 1;
  } else {
    console.log("\nOK: Evil Cloud purchase denied with expected policy violations.");
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

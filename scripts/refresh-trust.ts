import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { refreshMerchantTrust } from "../lib/risk/trust-refresh.ts";

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
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable ${name}`);
  return value;
}

async function main(): Promise<void> {
  loadEnvLocal();
  const db = createClient(required("NEXT_PUBLIC_SUPABASE_URL"), required("SUPABASE_SECRET_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await db
    .from("merchants")
    .select("id, slug, domain, trust_score_source")
    .neq("trust_score_source", "fixture")
    .not("domain", "is", null);

  if (error) {
    throw new Error(error.message);
  }

  const merchants = data ?? [];
  console.log(`Refreshing trust for ${merchants.length} merchant(s)…`);

  for (const merchant of merchants) {
    const domain = merchant.domain as string;
    try {
      const result = await refreshMerchantTrust(db, { merchantId: merchant.id as string });
      const scoreLabel = result.score === null ? "—" : String(result.score);
      console.log(`${merchant.slug as string} (${domain}): ${scoreLabel} [${result.source}]`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`${merchant.slug as string} (${domain}): failed — ${message}`);
    }
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
});

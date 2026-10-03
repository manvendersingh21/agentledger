import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

function loadEnvLocal(): void {
  const path = resolve(process.cwd(), ".env.local");
  if (!existsSync(path)) {
    console.error(".env.local not found (copy from .env.example)");
    return;
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

function has(name: string): boolean {
  const v = process.env[name];
  return typeof v === "string" && v.length > 0;
}

function isHttpUrl(value: string): { ok: boolean; note?: string } {
  try {
    const u = new URL(value);
    if (u.protocol !== "http:" && u.protocol !== "https:") {
      return { ok: false, note: "must use http: or https:" };
    }
    if (!u.host) {
      return { ok: false, note: "missing host" };
    }
    return { ok: true };
  } catch {
    return { ok: false, note: "not a valid URL" };
  }
}

function stripeKeyShape(value: string): { ok: boolean; note?: string } {
  if (value.startsWith("sk_test_") || value.startsWith("rk_test_")) {
    return { ok: true };
  }
  if (value.startsWith("sk_live_") || value.startsWith("rk_live_")) {
    return { ok: false, note: "live Stripe keys are refused; use sk_test_ or rk_test_" };
  }
  return { ok: false, note: "expected sk_test_ or rk_test_ prefix" };
}

type VarSpec = {
  name: string;
  required: boolean;
  validate?: (value: string) => { ok: boolean; note?: string };
  group: string;
};

const SPECS: VarSpec[] = [
  {
    name: "NEXT_PUBLIC_SUPABASE_URL",
    required: true,
    validate: (v) => isHttpUrl(v),
    group: "app",
  },
  {
    name: "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
    required: true,
    group: "app",
  },
  { name: "SUPABASE_SECRET_KEY", required: true, group: "app" },
  {
    name: "NEXT_PUBLIC_APP_URL",
    required: true,
    validate: (v) => isHttpUrl(v),
    group: "app",
  },
  { name: "PAYMENT_PROVIDER", required: false, group: "payments" },
  {
    name: "STRIPE_SECRET_KEY",
    required: false,
    validate: stripeKeyShape,
    group: "payments",
  },
  { name: "STRIPE_WEBHOOK_SECRET", required: false, group: "payments" },
  { name: "JEV_API_KEY", required: false, group: "guardrails" },
  { name: "OPENAI_API_KEY", required: false, group: "playground" },
  { name: "NEXT_PUBLIC_DEMO_MODE", required: false, group: "app" },
  { name: "SCAMADVISOR_API_KEY", required: false, group: "guardrails" },
  { name: "SCAMADVISOR_API_URL", required: false, group: "guardrails" },
  {
    name: "SUPABASE_PROJECT_REF",
    required: false,
    group: "hosted-deploy",
  },
  { name: "SUPABASE_DB_PASSWORD", required: false, group: "hosted-deploy" },
  { name: "SUPABASE_ACCESS_TOKEN", required: false, group: "hosted-deploy" },
];

function reportSpec(spec: VarSpec): { ok: boolean } {
  const present = has(spec.name);
  if (!present) {
    const label = spec.required ? "MISSING (required)" : "missing (optional)";
    console.log(`  ${spec.name}: ${label}`);
    return { ok: !spec.required };
  }

  const value = process.env[spec.name] ?? "";
  if (spec.validate) {
    const result = spec.validate(value);
    if (!result.ok) {
      console.log(`  ${spec.name}: present — invalid format (${result.note ?? "check value"})`);
      return { ok: false };
    }
  }

  console.log(`  ${spec.name}: present`);
  return { ok: true };
}

function main(): void {
  loadEnvLocal();

  const paymentProvider = (process.env.PAYMENT_PROVIDER ?? "stripe").toLowerCase();
  const stripeRequired = paymentProvider === "stripe";

  console.log("AgentLedger environment check (.env.local + process env)\n");
  console.log("Values are never printed.\n");

  let allOk = true;

  const groups = new Map<string, VarSpec[]>();
  for (const spec of SPECS) {
    const list = groups.get(spec.group) ?? [];
    list.push(spec);
    groups.set(spec.group, list);
  }

  const order = ["app", "payments", "guardrails", "playground", "hosted-deploy"];
  for (const group of order) {
    const specs = groups.get(group);
    if (!specs) continue;
    console.log(`[${group}]`);
    for (const spec of specs) {
      let effective = spec;
      if (spec.name === "STRIPE_SECRET_KEY" && stripeRequired) {
        effective = { ...spec, required: true };
      }
      const { ok } = reportSpec(effective);
      if (!ok) allOk = false;
    }
    console.log("");
  }

  if (paymentProvider !== "stripe" && paymentProvider !== "demo") {
    console.log(`PAYMENT_PROVIDER="${paymentProvider}" is unrecognized (use stripe or demo).`);
    allOk = false;
  }

  if (allOk) {
    console.log("Summary: all required variables present and formats look valid.");
    process.exit(0);
  } else {
    console.log("Summary: fix missing or invalid variables above.");
    process.exit(1);
  }
}

main();

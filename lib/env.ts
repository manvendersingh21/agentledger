import "server-only";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable ${name}`);
  return value;
}

export const serverEnv = {
  supabaseUrl: () => required("NEXT_PUBLIC_SUPABASE_URL"),
  supabasePublishableKey: () => required("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"),
  supabaseSecretKey: () => required("SUPABASE_SECRET_KEY"),
  stripeSecretKey: () => process.env.STRIPE_SECRET_KEY ?? null,
  openaiApiKey: () => process.env.OPENAI_API_KEY ?? null,
  jevApiKey: () => process.env.JEV_API_KEY ?? null,
  paymentProvider: () => (process.env.PAYMENT_PROVIDER ?? "stripe") as "stripe" | "demo",
  agentModel: () => process.env.AGENT_MODEL ?? "gpt-5.4-mini",
  demoMode: () => process.env.NEXT_PUBLIC_DEMO_MODE === "true",
};

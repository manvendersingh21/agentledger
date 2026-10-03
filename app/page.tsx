import Link from "next/link";
import {
  ArrowDownRight,
  BadgeCheck,
  Fingerprint,
  Gauge,
  OctagonX,
  ScrollText,
  ShieldCheck,
  Store,
  UserCheck,
} from "lucide-react";
import { ArrowButton } from "@/components/brand/arrow-button";
import { Eyebrow } from "@/components/brand/eyebrow";
import { PixelGlobe } from "@/components/brand/pixel-globe";
import { ScatterHeading } from "@/components/brand/scatter-heading";
import { Wordmark } from "@/components/brand/wordmark";

const NAV_LINKS = [
  { href: "#product", label: "Product" },
  { href: "#security", label: "Security" },
  { href: "#mcp", label: "MCP" },
  { href: "#flow", label: "Docs" },
  { href: "/merchants", label: "For merchants" },
];

const STATS = [
  { value: "100%", label: "Every action audited" },
  { value: "0", label: "Duplicate charges in replay test" },
  { value: "Deny", label: "Always wins over allow" },
];

const BUILT_ON = ["Supabase", "Stripe test mode", "OpenAI", "Jev", "MCP", "Next.js", "Postgres RLS", "Realtime"];

const FEATURES = [
  {
    icon: Gauge,
    eyebrow: "Authorization",
    title: "Deterministic policy",
    body: "Every intent runs through the same rules engine — budgets, merchants, categories and scopes. Same input, same decision, every time.",
  },
  {
    icon: UserCheck,
    eyebrow: "Approvals",
    title: "Human approval in real time",
    body: "High-impact actions pause and wait for a person. Approvals land live in the dashboard and resolve the agent the moment you decide.",
  },
  {
    icon: ScrollText,
    eyebrow: "Audit",
    title: "Tamper-evident audit",
    body: "Each decision, execution and receipt is hash-chained into an append-only ledger you can verify end to end.",
  },
];

const FLOW = ["Principal", "Delegation", "Intent", "Policy", "Approval", "Execution", "Receipt", "Audit"];

function AccentHeadline() {
  return (
    <h1 className="font-display text-[44px] font-semibold leading-[0.95] tracking-[-0.045em] text-ink sm:text-6xl lg:text-[88px] xl:text-[104px]">
      Give agents <span className="text-accent">authority</span> without giving them{" "}
      <span className="text-accent">control</span>.
    </h1>
  );
}

export default function Home() {
  return (
    <div className="flex min-h-screen flex-1 flex-col bg-canvas font-sans text-ink">
      {/* Floating pill header */}
      <header className="sticky top-0 z-40 px-4 pt-4 sm:px-6">
        <div className="mx-auto flex max-w-7xl items-center gap-3">
          <nav className="flex h-14 flex-1 items-center justify-between rounded-lg border border-line bg-surface px-4 sm:px-5">
            <Link href="/" aria-label="AgentLedger home">
              <Wordmark />
            </Link>
            <ul className="hidden items-center gap-7 text-sm text-ink-2 md:flex">
              {NAV_LINKS.map((link) => (
                <li key={link.label}>
                  <a href={link.href} className="transition-colors hover:text-ink">
                    {link.label}
                  </a>
                </li>
              ))}
              <li>
                <Link href="/login" className="transition-colors hover:text-ink">
                  Sign in
                </Link>
              </li>
            </ul>
          </nav>
          <div className="hidden sm:block">
            <ArrowButton href="/dashboard">Open dashboard</ArrowButton>
          </div>
        </div>
      </header>

      <main className="flex-1">
        {/* Hero */}
        <section className="mx-auto grid max-w-7xl gap-10 px-4 pb-16 pt-16 sm:px-6 md:pt-24 lg:grid-cols-2 lg:items-start lg:gap-6">
          <div className="z-10 order-1 flex flex-col gap-8 lg:col-start-1 lg:row-start-1">
            <Eyebrow>Authorization layer for AI agents</Eyebrow>
            <AccentHeadline />
            <p className="max-w-xl text-lg leading-relaxed text-ink-2">
              AgentLedger evaluates, approves, executes, and audits consequential AI-agent actions.
            </p>
            <div className="flex flex-wrap gap-3">
              <ArrowButton href="/dashboard">Open dashboard</ArrowButton>
              <ArrowButton href="/login" variant="secondary">
                Sign in
              </ArrowButton>
            </div>
          </div>
          <div className="relative order-2 flex min-h-[min(88vw,420px)] items-start justify-center lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:min-h-[560px] lg:justify-end lg:overflow-visible">
            <PixelGlobe
              size={560}
              className="aspect-square h-auto max-w-full lg:absolute lg:-top-20 lg:right-0 lg:max-h-none lg:max-w-[min(115%,560px)] lg:w-[min(52vw,560px)]"
            />
          </div>
          <div className="order-3 z-10 w-full max-w-md rounded-md bg-inverse p-6 text-white lg:col-start-1 lg:row-start-2">
            <p className="mb-5 text-[11px] font-medium uppercase tracking-[0.14em] text-white/60">
              Live demo results
            </p>
            <dl className="space-y-4">
              {STATS.map((stat) => (
                <div key={stat.label} className="flex items-baseline justify-between gap-4 border-t border-white/15 pt-3">
                  <dt className="text-sm text-white/70">{stat.label}</dt>
                  <dd className="font-display text-3xl font-semibold tracking-[-0.04em]">{stat.value}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        {/* Built on strip */}
        <section className="mx-auto max-w-7xl px-4 py-16 sm:px-6">
          <div className="mb-6 flex items-center justify-between">
            <Eyebrow>Built on</Eyebrow>
            <span className="hidden text-sm text-ink-3 sm:block">Open, inspectable infrastructure</span>
          </div>
          <ul className="grid grid-cols-2 border-l border-t border-line bg-surface md:grid-cols-4">
            {BUILT_ON.map((name) => (
              <li
                key={name}
                className="flex h-24 items-center justify-center border-b border-r border-line px-4 text-center font-display text-lg font-semibold tracking-[-0.03em] text-ink-3 transition-colors hover:text-ink"
              >
                {name}
              </li>
            ))}
          </ul>
        </section>

        {/* For merchants */}
        <section className="mx-auto max-w-7xl px-4 py-20 sm:px-6">
          <div className="grid gap-4 rounded-md border border-line bg-surface p-8 md:grid-cols-[minmax(0,1.35fr)_minmax(280px,0.65fr)] md:p-10">
            <div className="max-w-3xl space-y-5">
              <Eyebrow>For merchants</Eyebrow>
              <h2 className="font-display text-4xl font-semibold leading-[0.95] tracking-[-0.045em] md:text-6xl">
                Make your store <span className="text-accent">agent-ready.</span>
              </h2>
              <p className="max-w-2xl text-[15px] leading-relaxed text-ink-2">
                Verify your domain, publish an authoritative catalog, and make your products
                purchasable by MCP agents through buyer-controlled policy.
              </p>
              <ArrowButton href="/merchants">Explore merchant access</ArrowButton>
            </div>
            <div className="flex min-h-64 flex-col justify-between rounded-md bg-inverse p-7 text-white">
              <Store className="size-6 text-accent-soft" aria-hidden />
              <div>
                <p className="font-display text-3xl font-semibold leading-none tracking-[-0.04em]">
                  One feed.
                  <br />
                  Any MCP agent.
                </p>
                <p className="mt-4 text-sm leading-relaxed text-white/60">
                  Unverified websites still work through a fallback that always requires human approval.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Product */}
        <section id="product" className="mx-auto max-w-7xl scroll-mt-24 px-4 py-20 sm:px-6">
          <div className="mb-12 max-w-4xl space-y-5">
            <Eyebrow>Product</Eyebrow>
            <ScatterHeading
              as="h2"
              text="Agents propose. Policies decide. Humans stay in control."
              accentWords={["Policies", "Humans"]}
              className="font-display text-4xl font-semibold leading-[0.95] tracking-[-0.045em] text-ink md:text-6xl"
            />
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            {FEATURES.map(({ icon: Icon, eyebrow, title, body }) => (
              <article key={title} className="flex flex-col gap-6 rounded-md border border-line bg-surface p-7">
                <div className="flex items-center justify-between">
                  <Eyebrow>{eyebrow}</Eyebrow>
                  <span className="flex h-10 w-10 items-center justify-center rounded bg-accent-wash text-accent">
                    <Icon className="h-5 w-5" aria-hidden />
                  </span>
                </div>
                <h3 className="font-display text-3xl font-semibold leading-none tracking-[-0.04em]">{title}</h3>
                <p className="text-[15px] leading-relaxed text-ink-2">{body}</p>
              </article>
            ))}
          </div>
        </section>

        {/* Security: guardrails + registry */}
        <section id="security" className="mx-auto max-w-7xl scroll-mt-24 px-4 py-20 sm:px-6">
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
            <article className="rounded-md bg-inverse p-8 text-white md:p-10">
              <p className="mb-6 text-[11px] font-medium uppercase tracking-[0.14em] text-accent-soft">Guardrails</p>
              <h3 className="max-w-lg font-display text-4xl font-semibold leading-[0.95] tracking-[-0.045em] md:text-5xl">
                Stop the bad action <span className="text-accent-soft">before</span> it costs anything.
              </h3>
              <ul className="mt-10 grid gap-px overflow-hidden rounded bg-white/10 sm:grid-cols-3">
                {[
                  {
                    icon: ShieldCheck,
                    title: "Jev signals",
                    body: "Prompt-injection and price-anomaly signals feed straight into the decision.",
                  },
                  {
                    icon: Fingerprint,
                    title: "Trust ≥ 95",
                    body: "Merchants below the trust threshold are escalated or denied.",
                  },
                  {
                    icon: OctagonX,
                    title: "Kill switch",
                    body: "One toggle halts every agent action instantly. Deny always wins.",
                  },
                ].map(({ icon: Icon, title, body }) => (
                  <li key={title} className="bg-inverse p-5">
                    <Icon className="mb-4 h-5 w-5 text-accent-soft" aria-hidden />
                    <p className="font-medium">{title}</p>
                    <p className="mt-2 text-sm leading-relaxed text-white/65">{body}</p>
                  </li>
                ))}
              </ul>
            </article>
            <article className="flex flex-col justify-between gap-8 rounded-md border border-line bg-surface p-8 md:p-10">
              <div className="space-y-5">
                <Eyebrow>Verified Merchant Registry</Eyebrow>
                <h3 className="font-display text-4xl font-semibold leading-[0.95] tracking-[-0.045em]">
                  Know who your agent is paying.
                </h3>
                <p className="text-[15px] leading-relaxed text-ink-2">
                  Merchants prove control of their domain. Agents check the registry before checkout, and anyone can
                  look up a public verification page.
                </p>
              </div>
              <div className="flex items-center gap-3 rounded border border-line bg-canvas px-4 py-3">
                <BadgeCheck className="h-5 w-5 text-accent" aria-hidden />
                <span className="font-mono text-sm text-ink-2">/verified/&lt;domain&gt;</span>
              </div>
            </article>
          </div>
        </section>

        {/* MCP */}
        <section id="mcp" className="mx-auto max-w-7xl scroll-mt-24 px-4 py-20 sm:px-6">
          <div className="grid gap-8 rounded-md border border-line bg-surface p-8 md:grid-cols-2 md:items-center md:p-10">
            <div className="space-y-5">
              <Eyebrow>MCP</Eyebrow>
              <h3 className="font-display text-4xl font-semibold leading-[0.95] tracking-[-0.045em]">
                Plug any agent in over <span className="text-accent">MCP</span>.
              </h3>
              <p className="text-[15px] leading-relaxed text-ink-2">
                Agents connect with OAuth consent, then submit intents through the MCP server. Every call is scoped to
                the delegation you granted.
              </p>
            </div>
            <pre className="overflow-x-auto rounded bg-inverse p-5 font-mono text-xs leading-relaxed text-white/80">
              <code>{`→ submit_intent
  merchant  "store.example"
  amount    $42.00
← decision  REQUIRE_HUMAN
  reason    "above auto-approve limit"`}</code>
            </pre>
          </div>
        </section>

        {/* Flow */}
        <section id="flow" className="mx-auto max-w-7xl scroll-mt-24 px-4 py-20 sm:px-6">
          <div className="mb-10 space-y-5">
            <Eyebrow>How it works</Eyebrow>
            <h2 className="max-w-3xl font-display text-4xl font-semibold leading-[0.95] tracking-[-0.045em] md:text-5xl">
              Every consequential action gets a principal, scope, policy, decision and receipt.
            </h2>
          </div>
          <ol className="grid grid-cols-2 gap-px overflow-hidden rounded-md border border-line bg-line sm:grid-cols-4 lg:grid-cols-8">
            {FLOW.map((step, index) => (
              <li key={step} className="flex flex-col justify-between gap-8 bg-surface p-5">
                <span className="font-mono text-xs text-ink-3">{String(index + 1).padStart(2, "0")}</span>
                <div className="flex items-end justify-between gap-2">
                  <span
                    className={`font-display text-lg font-semibold tracking-[-0.03em] ${
                      step === "Policy" ? "text-accent" : "text-ink"
                    }`}
                  >
                    {step}
                  </span>
                  {index < FLOW.length - 1 ? (
                    <ArrowDownRight className="h-4 w-4 -rotate-45 text-ink-3" aria-hidden />
                  ) : null}
                </div>
              </li>
            ))}
          </ol>
          <div className="mt-4 flex flex-wrap gap-2 text-[11px] font-medium uppercase tracking-[0.12em]">
            <span className="rounded bg-blocked-bg px-2.5 py-1 text-blocked">Deny</span>
            <span className="rounded bg-executed-bg px-2.5 py-1 text-executed">Auto-approve</span>
            <span className="rounded bg-waiting-bg px-2.5 py-1 text-waiting">Require human</span>
          </div>
        </section>

        {/* CTA */}
        <section className="mx-auto max-w-7xl px-4 pb-20 sm:px-6">
          <div className="flex flex-col items-start justify-between gap-8 rounded-md bg-accent p-8 text-white md:flex-row md:items-end md:p-12">
            <h2 className="max-w-2xl font-display text-4xl font-semibold leading-[0.95] tracking-[-0.045em] md:text-6xl">
              Ship agents you can actually trust.
            </h2>
            <ArrowButton href="/dashboard" variant="secondary">
              Open dashboard
            </ArrowButton>
          </div>
        </section>
      </main>

      <footer className="border-t border-line bg-surface">
        <div className="mx-auto flex max-w-7xl flex-col gap-6 px-4 py-10 sm:px-6 md:flex-row md:items-center md:justify-between">
          <div className="space-y-2">
            <Wordmark />
            <p className="text-sm text-ink-3">The authorization and transaction layer for AI agents.</p>
          </div>
          <ul className="flex flex-wrap gap-6 text-sm text-ink-2">
            {NAV_LINKS.map((link) => (
              <li key={link.label}>
                <a href={link.href} className="hover:text-ink">
                  {link.label}
                </a>
              </li>
            ))}
            <li>
              <Link href="/login" className="hover:text-ink">
                Sign in
              </Link>
            </li>
          </ul>
        </div>
      </footer>
    </div>
  );
}

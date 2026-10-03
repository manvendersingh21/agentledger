import type { Metadata } from "next";
import Link from "next/link";
import { BadgeCheck, Bot, Braces, ShieldCheck, Store } from "lucide-react";
import { ArrowButton } from "@/components/brand/arrow-button";
import { Eyebrow } from "@/components/brand/eyebrow";
import { Wordmark } from "@/components/brand/wordmark";
import { getPrincipal } from "@/lib/auth/session";
import { DomainLookup, MerchantApplication } from "./merchants-client";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "For merchants | AgentLedger",
  description:
    "Verify your store, publish an agent-ready catalog, and reach purchasing agents through AgentLedger.",
};

const STEPS = [
  {
    number: "01",
    title: "Prove domain control",
    body: "Add a DNS record or a well-known file. Verification confirms control of the domain; it is not an endorsement.",
  },
  {
    number: "02",
    title: "Publish your catalog",
    body: "Send authoritative product names, prices, categories, and terms through the merchant feed.",
  },
  {
    number: "03",
    title: "Reach purchasing agents",
    body: "MCP agents can discover your catalog and propose purchases under each buyer’s policy.",
  },
];

const CAPABILITIES = [
  {
    icon: BadgeCheck,
    label: "Verification",
    title: "A portable trust signal",
    body: "Agents can confirm that a catalog belongs to the business controlling its domain.",
  },
  {
    icon: Braces,
    label: "Catalog",
    title: "Authoritative terms",
    body: "Your feed is the source for price and product terms instead of an agent’s interpretation of a web page.",
  },
  {
    icon: ShieldCheck,
    label: "Policy",
    title: "Buyer control stays intact",
    body: "Every purchase still passes deterministic limits, merchant rules, approval thresholds, and audit.",
  },
];

export default async function MerchantsPage() {
  const principal = await getPrincipal();
  const registryHref = principal
    ? "/dashboard/registry"
    : "/login?next=/dashboard/registry";

  return (
    <div className="min-h-screen bg-canvas font-sans text-ink">
      <header className="sticky top-0 z-40 px-4 pt-4 sm:px-6">
        <div className="mx-auto flex max-w-7xl items-center gap-3">
          <nav className="flex h-14 flex-1 items-center justify-between rounded-lg border border-line bg-surface px-4 sm:px-5">
            <Link href="/" aria-label="AgentLedger home">
              <Wordmark />
            </Link>
            <div className="hidden items-center gap-7 text-sm text-ink-2 md:flex">
              <a href="#how-it-works" className="transition-colors hover:text-ink">
                How it works
              </a>
              <a href="#lookup" className="transition-colors hover:text-ink">
                Check a domain
              </a>
              <a href="#apply" className="transition-colors hover:text-ink">
                Contact
              </a>
            </div>
          </nav>
          <div className="hidden sm:block">
            <ArrowButton href={registryHref}>
              {principal ? "Open registry" : "Get verified"}
            </ArrowButton>
          </div>
        </div>
      </header>

      <main>
        <section className="mx-auto grid max-w-7xl gap-6 px-4 pb-20 pt-16 sm:px-6 md:pt-24 lg:grid-cols-[minmax(0,1.45fr)_minmax(320px,0.65fr)]">
          <div className="flex min-h-[540px] flex-col justify-between rounded-md border border-line bg-surface p-7 sm:p-10 lg:p-12">
            <div className="flex items-center justify-between gap-4">
              <Eyebrow>Agent commerce infrastructure</Eyebrow>
              <Store className="size-5 text-accent" aria-hidden />
            </div>
            <div className="mt-20">
              <h1 className="max-w-4xl font-display text-[54px] font-semibold leading-[0.92] tracking-[-0.05em] sm:text-7xl lg:text-[92px]">
                Make your store <span className="text-accent">agent-ready.</span>
              </h1>
              <p className="mt-8 max-w-2xl text-lg leading-relaxed text-ink-2">
                Verify your domain, publish a trusted catalog, and let purchasing agents
                transact through AgentLedger without giving up buyer policy or human control.
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                <ArrowButton href={registryHref}>
                  {principal ? "Open merchant registry" : "Get verified"}
                </ArrowButton>
                <ArrowButton href="#lookup" variant="secondary">
                  Check your domain
                </ArrowButton>
              </div>
            </div>
          </div>

          <aside className="flex flex-col justify-between rounded-md bg-inverse p-7 text-white sm:p-9">
            <div>
              <div className="flex items-center justify-between">
                <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-accent-soft">
                  The agent channel
                </p>
                <Bot className="size-5 text-accent-soft" aria-hidden />
              </div>
              <p className="mt-8 font-display text-4xl font-semibold leading-[0.96] tracking-[-0.045em]">
                One catalog.
                <br />
                Any MCP agent.
              </p>
              <p className="mt-5 text-sm leading-relaxed text-white/65">
                Claude, Cursor, ChatGPT, and other MCP clients can reach your store
                through a consistent purchasing interface.
              </p>
            </div>

            <dl className="mt-16 space-y-4">
              <div className="border-t border-white/15 pt-4">
                <dt className="text-xs text-white/45">Verified merchant</dt>
                <dd className="mt-1 text-sm text-white">Catalog purchase under buyer policy</dd>
              </div>
              <div className="border-t border-white/15 pt-4">
                <dt className="text-xs text-white/45">Unverified website</dt>
                <dd className="mt-1 text-sm text-white">Fallback with mandatory human approval</dd>
              </div>
              <div className="border-t border-white/15 pt-4">
                <dt className="text-xs text-white/45">Every outcome</dt>
                <dd className="mt-1 text-sm text-white">Policy decision, receipt, and audit trail</dd>
              </div>
            </dl>
          </aside>
        </section>

        <section id="how-it-works" className="mx-auto max-w-7xl scroll-mt-24 px-4 py-20 sm:px-6">
          <div className="mb-12 max-w-3xl">
            <Eyebrow>How it works</Eyebrow>
            <h2 className="mt-5 font-display text-4xl font-semibold leading-[0.95] tracking-[-0.045em] sm:text-6xl">
              From website to <span className="text-accent">agent channel</span> in three steps.
            </h2>
          </div>
          <ol className="grid gap-px overflow-hidden rounded-md border border-line bg-line lg:grid-cols-3">
            {STEPS.map((step) => (
              <li key={step.number} className="flex min-h-72 flex-col justify-between bg-surface p-7">
                <span className="font-mono text-xs text-accent">{step.number}</span>
                <div>
                  <h3 className="font-display text-3xl font-semibold leading-none tracking-[-0.04em]">
                    {step.title}
                  </h3>
                  <p className="mt-4 text-sm leading-relaxed text-ink-2">{step.body}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        <section id="lookup" className="mx-auto max-w-7xl scroll-mt-24 px-4 py-20 sm:px-6">
          <div className="grid gap-4 lg:grid-cols-[minmax(0,0.75fr)_minmax(0,1.25fr)]">
            <div className="flex flex-col justify-between rounded-md bg-accent p-7 text-white sm:p-9">
              <div>
                <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-white/65">
                  Merchant intelligence
                </p>
                <h2 className="mt-6 font-display text-5xl font-semibold leading-[0.92] tracking-[-0.05em]">
                  See what an agent sees.
                </h2>
              </div>
              <p className="mt-16 max-w-md text-sm leading-relaxed text-white/75">
                Check verification status, the current public ScamAdviser signal, and how
                AgentLedger’s default policy would route a purchase.
              </p>
            </div>
            <DomainLookup />
          </div>
        </section>

        <section className="mx-auto max-w-7xl px-4 py-20 sm:px-6">
          <div className="mb-12 max-w-3xl">
            <Eyebrow>Built for both sides</Eyebrow>
            <h2 className="mt-5 font-display text-4xl font-semibold leading-[0.95] tracking-[-0.045em] sm:text-6xl">
              More reach for merchants. <span className="text-accent">No weaker controls</span> for buyers.
            </h2>
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            {CAPABILITIES.map(({ icon: Icon, label, title, body }) => (
              <article key={title} className="rounded-md border border-line bg-surface p-7">
                <div className="flex items-center justify-between">
                  <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-accent">
                    {label}
                  </p>
                  <span className="flex size-10 items-center justify-center rounded bg-accent-wash text-accent">
                    <Icon className="size-5" aria-hidden />
                  </span>
                </div>
                <h3 className="mt-12 font-display text-3xl font-semibold leading-none tracking-[-0.04em]">
                  {title}
                </h3>
                <p className="mt-4 text-sm leading-relaxed text-ink-2">{body}</p>
              </article>
            ))}
          </div>
        </section>

        <section id="apply" className="mx-auto max-w-7xl scroll-mt-24 px-4 pb-24 pt-20 sm:px-6">
          <div className="grid gap-4 lg:grid-cols-[minmax(0,0.75fr)_minmax(0,1.25fr)]">
            <div className="flex flex-col justify-between rounded-md border border-line bg-surface p-7 sm:p-9">
              <div>
                <Eyebrow>Get started</Eyebrow>
                <h2 className="mt-6 font-display text-5xl font-semibold leading-[0.92] tracking-[-0.05em]">
                  Open a new route to market.
                </h2>
                <p className="mt-5 max-w-md text-sm leading-relaxed text-ink-2">
                  Already have an account? Start self-service domain verification in the
                  merchant registry. Or send us your catalog requirements.
                </p>
              </div>
              <div className="mt-12">
                <ArrowButton href={registryHref} variant="secondary">
                  {principal ? "Open merchant registry" : "Sign in to verify"}
                </ArrowButton>
              </div>
            </div>
            <MerchantApplication />
          </div>
        </section>
      </main>

      <footer className="border-t border-line bg-surface">
        <div className="mx-auto flex max-w-7xl flex-col gap-6 px-4 py-10 sm:px-6 md:flex-row md:items-center md:justify-between">
          <div>
            <Wordmark />
            <p className="mt-2 text-sm text-ink-3">
              The authorization and transaction layer for AI agents.
            </p>
          </div>
          <div className="flex flex-wrap gap-6 text-sm text-ink-2">
            <Link href="/" className="hover:text-ink">
              Home
            </Link>
            <Link href={registryHref} className="hover:text-ink">
              Merchant registry
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}

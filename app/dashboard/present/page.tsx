import type { Metadata } from "next";
import Link from "next/link";
import { ArrowDownRight, ExternalLink } from "lucide-react";
import { Eyebrow } from "@/components/brand/eyebrow";

export const metadata: Metadata = {
  title: "Presenter checklist | AgentLedger",
  description: "Ordered screen links for the three-minute core demo and eight-minute full feature tour.",
};

interface DemoStep {
  time: string;
  title: string;
  screen: string;
  href: string;
  cue: string;
}

const CORE_DEMO_STEPS = [
  {
    time: "0:00",
    title: "The problem",
    screen: "Overview",
    href: "/dashboard",
    cue: "Authority without control. Agents propose; policy decides.",
  },
  {
    time: "0:15",
    title: "Delegation + guardrails",
    screen: "Delegation",
    href: "/dashboard/delegations",
    cue: "$150 max · $300/day · approve above $60 · trust 95 · kill switch on",
  },
  {
    time: "0:35",
    title: "Bedroom fan",
    screen: "Concierge",
    href: "/dashboard/concierge",
    cue: "350 sq ft · no existing fan · budget $100 · approve on phone",
  },
  {
    time: "1:20",
    title: "Live architecture",
    screen: "Transactions",
    href: "/dashboard/transactions",
    cue: "Open the executed fan: trust → Jev → policy → hash-bound approval → Stripe → receipt → audit",
  },
  {
    time: "1:50",
    title: "Bitcoin voucher attack",
    screen: "Concierge",
    href: "/dashboard/concierge",
    cue: "Blocked by category + trust + Jev",
  },
  {
    time: "2:10",
    title: "Red-team kill switch",
    screen: "Playground",
    href: "/dashboard/playground",
    cue: "Compromised agent on → Run agent → AGENT HALTED",
  },
  {
    time: "2:30",
    title: "Replay retry",
    screen: "Transactions",
    href: "/dashboard/transactions",
    cue: "Open the executed fan → Simulate retry → additional charge $0.00",
  },
  {
    time: "2:39",
    title: "Integrity verified",
    screen: "Audit Trail",
    href: "/dashboard/audit",
    cue: "Re-verify chain → Audit integrity ✓ Verified",
  },
  {
    time: "2:45",
    title: "Merchant network",
    screen: "Public merchant lookup",
    href: "/merchants#lookup",
    cue: "amazon.com → Not verified + live ScamAdviser score + fallback rules",
  },
] as const satisfies readonly DemoStep[];

const FULL_TOUR_STEPS = [
  {
    time: "0:00",
    title: "Overview hub",
    screen: "Overview",
    href: "/dashboard",
    cue: "Metrics, protected spend, outcomes, and the live activity stream",
  },
  {
    time: "0:20",
    title: "Five policy presets",
    screen: "Scenarios",
    href: "/dashboard/scenarios",
    cue: "Home → DIY → Grocery → Restaurant → Software → finish on Home",
  },
  {
    time: "0:55",
    title: "Delegated authority",
    screen: "Delegation",
    href: "/dashboard/delegations",
    cue: "Limits · approvals · subscriptions off · merchant trust · websites · Jev · kill switch",
  },
  {
    time: "1:35",
    title: "Bedroom fan",
    screen: "Concierge",
    href: "/dashboard/concierge",
    cue: "350 sq ft · quiet · $100 · leave the over-threshold proposal waiting",
  },
  {
    time: "2:00",
    title: "DIY shelves",
    screen: "Scenarios → Concierge",
    href: "/dashboard/scenarios",
    cue: "Apply DIY → ask what is already owned → tools and supplies separately",
  },
  {
    time: "2:25",
    title: "Lasagna to cart",
    screen: "Scenarios → Concierge",
    href: "/dashboard/scenarios",
    cue: "Apply Grocery → lasagna for 6 → what do you already have?",
  },
  {
    time: "2:50",
    title: "External website",
    screen: "Concierge",
    href: "/dashboard/concierge",
    cue: "Named HTTPS URL → live trust → unverified price → always human",
  },
  {
    time: "3:15",
    title: "Bitcoin voucher",
    screen: "Concierge",
    href: "/dashboard/concierge",
    cue: "Blocked by category + trust + Jev; show any kill-switch result",
  },
  {
    time: "3:35",
    title: "Grocery autopilot",
    screen: "Groceries",
    href: "/dashboard/groceries",
    cue: "Plan basket → skipped cheaper untrusted store → checkout outcomes",
  },
  {
    time: "4:00",
    title: "Restaurant autopilot",
    screen: "Inventory",
    href: "/dashboard/inventory",
    cue: "Busy night → routine buys · untrusted skip; prove the 3× price block in Attack Lab",
  },
  {
    time: "4:25",
    title: "$500 red team",
    screen: "Playground",
    href: "/dashboard/playground",
    cue: "Run compromised agent → Jev → kill switch → AGENT HALTED",
  },
  {
    time: "4:39",
    title: "Human re-enable",
    screen: "Agent",
    href: "/dashboard/agents",
    cue: "Suspended agent → Re-enable agent → active",
  },
  {
    time: "4:50",
    title: "Approve on phone",
    screen: "Approvals",
    href: "/dashboard/approvals",
    cue: "Installed web app · Realtime arrival · vibration · sticky Approve",
  },
  {
    time: "5:12",
    title: "Live architecture",
    screen: "Transactions",
    href: "/dashboard/transactions",
    cue: "Open executed fan: trust → Jev → policy → hash → Stripe → receipt → audit",
  },
  {
    time: "5:38",
    title: "Retry + Stripe",
    screen: "Transactions",
    href: "/dashboard/transactions",
    cue: "Causal timeline → Simulate retry → $0.00 → View in Stripe",
  },
  {
    time: "6:00",
    title: "Integrity verified",
    screen: "Audit Trail",
    href: "/dashboard/audit",
    cue: "Re-verify chain → inspect linked hashes and security events",
  },
  {
    time: "6:12",
    title: "All six attacks",
    screen: "Attack Lab",
    href: "/dashboard/attack-lab",
    cue: "Injection · tampering · replay · crypto · overpriced · approval hash mismatch",
  },
  {
    time: "6:50",
    title: "Merchant lookup",
    screen: "Merchant Network",
    href: "/merchants#lookup",
    cue: "amazon.com → Not verified + live score → application form",
  },
  {
    time: "7:12",
    title: "Verify + publish",
    screen: "Registry",
    href: "/dashboard/registry",
    cue: "DNS / well-known proof → API key → catalog-feed curl",
  },
  {
    time: "7:38",
    title: "Connect over MCP",
    screen: "Connect",
    href: "/dashboard/connect",
    cue: "Copy claude mcp add command → show the live connected-agents panel",
  },
  {
    time: "7:58",
    title: "Webhook reconciliation",
    screen: "Audit Trail",
    href: "/dashboard/audit",
    cue: "Refresh → PAYMENT SUCCEEDED → match PaymentIntent to receipt; close",
  },
] as const satisfies readonly DemoStep[];

const PREFLIGHT_LINKS = [
  { label: "1 · Reset demo", href: "/dashboard" },
  { label: "2 · Apply Home preset", href: "/dashboard/scenarios" },
  { label: "3 · Phone approvals", href: "/dashboard/approvals" },
] as const;

function StepGrid({
  steps,
  numberOffset = 0,
}: {
  steps: readonly DemoStep[];
  numberOffset?: number;
}) {
  return (
    <ol className="grid gap-4 lg:grid-cols-2">
      {steps.map((step, index) => (
        <li key={`${step.time}-${step.title}`}>
          <Link
            href={step.href}
            className="group flex h-full min-h-56 flex-col justify-between rounded-[6px] border border-line bg-surface p-6 transition-colors hover:border-accent hover:bg-accent-wash sm:p-8"
            aria-label={`${step.time}: ${step.title}. Open ${step.screen}.`}
          >
            <div className="flex items-start justify-between gap-5">
              <span className="font-mono text-sm font-semibold tabular-nums text-accent">
                {step.time}
              </span>
              <span className="text-right font-mono text-[11px] uppercase tracking-[0.12em] text-ink-3">
                {String(index + numberOffset + 1).padStart(2, "0")} · {step.screen}
              </span>
            </div>
            <div className="mt-12 flex items-end justify-between gap-6">
              <div>
                <h3 className="font-display text-3xl font-semibold leading-[0.95] tracking-[-0.045em] text-ink sm:text-4xl">
                  {step.title}
                </h3>
                <p className="mt-3 max-w-xl text-sm leading-relaxed text-ink-2">{step.cue}</p>
              </div>
              <span className="flex size-12 shrink-0 items-center justify-center rounded-[4px] bg-accent text-white transition-colors group-hover:bg-accent-hover">
                <ArrowDownRight
                  className="size-5 transition-transform group-hover:translate-x-0.5 group-hover:translate-y-0.5"
                  aria-hidden
                />
              </span>
            </div>
          </Link>
        </li>
      ))}
    </ol>
  );
}

export default function PresenterPage() {
  return (
    <div className="space-y-10 pb-10">
      <header className="rounded-[6px] border border-line bg-surface p-6 sm:p-8 md:p-10">
        <Eyebrow>Presenter mode</Eyebrow>
        <div className="mt-5 flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h1 className="max-w-4xl font-display text-[44px] font-semibold leading-[0.95] tracking-[-0.045em] text-ink sm:text-[56px] lg:text-[72px]">
              Two tours. <span className="text-accent">Every screen</span> in order.
            </h1>
            <p className="mt-5 max-w-2xl text-[15px] leading-relaxed text-ink-2">
              Run the focused three-minute story or the full feature tour. Each card opens the next hosted screen.
            </p>
          </div>
          <div className="flex shrink-0 gap-2">
            <p className="rounded-[4px] bg-inverse px-4 py-3 font-mono text-xs uppercase tracking-[0.12em] text-white">
              03:00 core
            </p>
            <p className="rounded-[4px] bg-accent px-4 py-3 font-mono text-xs uppercase tracking-[0.12em] text-white">
              ~08:00 full
            </p>
          </div>
        </div>
      </header>

      <section className="grid gap-4 md:grid-cols-2" aria-label="Choose a demo track">
        <a
          href="#core-demo"
          className="group flex min-h-56 flex-col justify-between rounded-[6px] border border-line bg-surface p-6 transition-colors hover:border-accent hover:bg-accent-wash sm:p-8"
        >
          <div className="flex items-center justify-between gap-4">
            <Eyebrow>Track 01</Eyebrow>
            <span className="font-mono text-xs uppercase tracking-[0.12em] text-ink-3">03:00</span>
          </div>
          <div>
            <h2 className="font-display text-4xl font-semibold leading-[0.95] tracking-[-0.045em] text-ink">
              Core demo
            </h2>
            <p className="mt-3 max-w-xl text-sm leading-relaxed text-ink-2">
              Delegation, concierge purchase, phone approval, Stripe, attacks, replay, audit, and merchant trust.
            </p>
          </div>
        </a>
        <a
          href="#full-tour"
          className="group flex min-h-56 flex-col justify-between rounded-[6px] bg-inverse p-6 text-white transition-colors hover:bg-ink sm:p-8"
        >
          <div className="flex items-center justify-between gap-4">
            <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-accent-soft">Track 02</p>
            <span className="font-mono text-xs uppercase tracking-[0.12em] text-white/60">~08:00</span>
          </div>
          <div>
            <h2 className="font-display text-4xl font-semibold leading-[0.95] tracking-[-0.045em]">
              Full feature tour
            </h2>
            <p className="mt-3 max-w-xl text-sm leading-relaxed text-white/65">
              Every hosted workflow, from presets and autopilots through Merchant Network, MCP, and webhooks.
            </p>
          </div>
        </a>
      </section>

      <section className="rounded-[6px] bg-inverse p-6 text-white sm:p-8">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-accent-soft">
              Before going live
            </p>
            <h2 className="mt-3 font-display text-3xl font-semibold leading-none tracking-[-0.04em]">
              Reset, preset, phone, Stripe.
            </h2>
          </div>
          <div className="flex flex-wrap gap-2">
            {PREFLIGHT_LINKS.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="rounded-[4px] border border-white/20 px-3 py-2 text-sm text-white transition-colors hover:border-accent-soft hover:text-accent-soft"
              >
                {item.label}
              </Link>
            ))}
            <a
              href="https://dashboard.stripe.com/test/payments"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-[4px] border border-white/20 px-3 py-2 text-sm text-white transition-colors hover:border-accent-soft hover:text-accent-soft"
            >
              4 · Stripe test tab
              <ExternalLink className="size-3.5" aria-hidden />
            </a>
          </div>
        </div>
      </section>

      <section id="core-demo" className="scroll-mt-24 space-y-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <Eyebrow>Core demo · 03:00</Eyebrow>
            <h2 className="mt-3 font-display text-3xl font-semibold tracking-[-0.04em] text-ink sm:text-4xl">
              Click top to bottom.
            </h2>
          </div>
          <Link
            href="/dashboard/attack-lab"
            className="inline-flex items-center gap-2 text-sm font-medium text-blocked hover:underline"
          >
            Open Attack Lab fallback
            <ArrowDownRight className="size-4" aria-hidden />
          </Link>
        </div>

        <StepGrid steps={CORE_DEMO_STEPS} />
      </section>

      <section id="full-tour" className="scroll-mt-24 space-y-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <Eyebrow>Full feature tour · ~08:00</Eyebrow>
            <h2 className="mt-3 font-display text-3xl font-semibold tracking-[-0.04em] text-ink sm:text-4xl">
              Every feature, in order.
            </h2>
            <p className="mt-3 max-w-2xl text-sm leading-relaxed text-ink-2">
              See docs/DEMO-SCRIPT.md for exact clicks, prepared inputs, timestamped narration, and live-service fallbacks.
            </p>
          </div>
          <a
            href="https://dashboard.stripe.com/test/payments"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 text-sm font-medium text-accent hover:underline"
          >
            Open Stripe test payments
            <ExternalLink className="size-4" aria-hidden />
          </a>
        </div>

        <StepGrid steps={FULL_TOUR_STEPS} />
      </section>
    </div>
  );
}

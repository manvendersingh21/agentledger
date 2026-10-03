import Link from "next/link";
import { ArrowDownRight, FlaskConical, ClipboardCheck } from "lucide-react";
import { ensureSetup, getAuditEvents, getMetrics } from "@/lib/data/queries";
import { formatCents } from "@/lib/utils";
import { MetricCard } from "@/components/dashboard/metric-card";
import { ActivityStream } from "@/components/dashboard/activity-stream";
import { DemoResetButton } from "@/components/dashboard/demo-reset-button";
import { RealtimeRefresh } from "@/components/dashboard/realtime-refresh";
import { Eyebrow } from "@/components/brand/eyebrow";
import { PixelGlobe } from "@/components/brand/pixel-globe";
export const dynamic = "force-dynamic";

const QUICK_LINKS = [
  { href: "/dashboard/playground", label: "Playground", icon: FlaskConical },
  { href: "/dashboard/approvals", label: "Approvals", icon: ClipboardCheck },
];

const USE_CASES = [
  {
    href: "/dashboard/concierge",
    emoji: "💬",
    title: "Concierge",
    description:
      "Chat to buy anything: a fan for the bedroom, DIY project supplies, recipe-to-cart groceries, or an item from an external website — all policy-checked.",
  },
  {
    href: "/dashboard/groceries",
    emoji: "🛒",
    title: "Groceries",
    description: "Weekly grocery autopilot: a standing list the agent restocks within your budget and category rules.",
  },
  {
    href: "/dashboard/inventory",
    emoji: "🍽️",
    title: "Restaurant autopilot",
    description:
      "Inventory-driven restocking: when stock hits the reorder point, the agent proposes bulk orders from trusted suppliers.",
  },
  {
    href: "/dashboard/playground",
    emoji: "🧩",
    title: "Software API playground",
    description: "Watch an agent shop for API plans live — including denied, approved, and replay-blocked attempts.",
  },
  {
    href: "/dashboard/registry",
    emoji: "🏷️",
    title: "Merchant network",
    description:
      "Verify your store, publish a catalog via the merchant feed API, and become purchasable by any MCP agent.",
  },
] as const;

export default async function DashboardOverviewPage() {
  const { principal } = await ensureSetup();
  const [metrics, events] = await Promise.all([getMetrics(), getAuditEvents(30)]);
  const demoMode = process.env.NEXT_PUBLIC_DEMO_MODE === "true";

  return (
    <>
      <RealtimeRefresh
        userId={principal.id}
        tables={["action_intents", "approvals", "audit_events", "executions", "agents"]}
      />

      <header className="relative overflow-visible rounded-md border border-line bg-surface p-6 md:p-10">
        <div className="flex flex-col gap-8 lg:flex-row lg:items-center lg:justify-between">
          <div className="relative z-10 min-w-0 max-w-3xl space-y-6">
            <Eyebrow>Overview</Eyebrow>
            <h1 className="font-display text-[44px] font-semibold leading-[0.95] tracking-[-0.045em] text-ink sm:text-[56px] lg:text-[72px]">
              Give agents <span className="text-accent">authority</span> without giving them{" "}
              <span className="text-accent">control</span>.
            </h1>
            <p className="max-w-xl text-[16px] leading-relaxed text-ink-2">
              AgentLedger evaluates, approves, executes, and audits consequential AI-agent actions.
            </p>
            <p className="text-[13px] font-semibold uppercase tracking-[0.12em] text-ink">
              Agents propose. Policies decide. Humans stay in control.
            </p>
            {demoMode ? (
              <div className="pt-2">
                <DemoResetButton />
              </div>
            ) : null}
          </div>
          <div className="hidden shrink-0 justify-end lg:flex lg:items-center">
            <PixelGlobe size={280} className="max-w-none" />
          </div>
        </div>
      </header>

      <section className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          tone="inverse"
          label="Spend protected"
          value={formatCents(metrics.spendProtectedCents)}
          hint="Blocked intent amounts"
          className="sm:col-span-2"
        />
        <MetricCard label="Actions evaluated" value={metrics.evaluated} />
        <MetricCard label="Actions blocked" value={metrics.blocked} />
        <MetricCard label="Human approvals" value={metrics.humanApprovals} />
        <MetricCard label="Transactions executed" value={metrics.executed} />
        <MetricCard label="Duplicates blocked" value={metrics.duplicatesBlocked} />
        <div className="flex min-h-[148px] flex-col justify-between rounded-md border border-line bg-surface p-5 md:p-6">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-3">Jump to</p>
          <div className="mt-4 flex flex-col gap-2">
            {QUICK_LINKS.map(({ href, label, icon: Icon }) => (
              <Link
                key={href}
                href={href}
                className="group flex h-11 items-center justify-between rounded border border-line px-3 text-[14px] font-medium text-ink transition-colors hover:border-accent hover:text-accent"
              >
                <span className="flex items-center gap-2">
                  <Icon className="size-4 text-ink-3 group-hover:text-accent" />
                  {label}
                </span>
                <ArrowDownRight className="size-4 transition-transform group-hover:translate-x-0.5 group-hover:translate-y-0.5" />
              </Link>
            ))}
          </div>
        </div>
      </section>

      <section className="mt-4 rounded-md border border-line bg-surface p-6 md:p-8">
        <Eyebrow>Use cases</Eyebrow>
        <h2 className="mt-3 font-display text-[28px] font-semibold leading-[0.95] tracking-[-0.045em] text-ink sm:text-[36px]">
          What can your <span className="text-accent">agent</span> do?
        </h2>
        <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {USE_CASES.map((useCase) => (
            <Link
              key={useCase.href + useCase.title}
              href={useCase.href}
              className="group flex flex-col rounded-[6px] border border-line bg-canvas p-4 transition-colors hover:border-accent hover:bg-accent-wash"
            >
              <span className="flex items-center justify-between">
                <span className="flex items-center gap-2">
                  <span className="text-xl" aria-hidden>
                    {useCase.emoji}
                  </span>
                  <span className="text-[15px] font-medium text-ink group-hover:text-accent">{useCase.title}</span>
                </span>
                <ArrowDownRight className="size-4 text-ink-3 transition-transform group-hover:translate-x-0.5 group-hover:translate-y-0.5 group-hover:text-accent" />
              </span>
              <span className="mt-2 text-[13px] leading-snug text-ink-2">{useCase.description}</span>
            </Link>
          ))}
        </div>
      </section>

      <section className="mt-4">
        <ActivityStream
          key={`${events.length}:${events[0]?.id ?? "none"}`}
          userId={principal.id}
          initialEvents={events}
        />
      </section>
    </>
  );
}

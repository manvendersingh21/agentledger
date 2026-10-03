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

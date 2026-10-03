import Link from "next/link";
import { FlaskConical, ClipboardCheck } from "lucide-react";
import { ensureSetup, getAuditEvents, getMetrics } from "@/lib/data/queries";
import { formatCents } from "@/lib/utils";
import { MetricCard } from "@/components/dashboard/metric-card";
import { ActivityStream } from "@/components/dashboard/activity-stream";
import { DemoResetButton } from "@/components/dashboard/demo-reset-button";
import { RealtimeRefresh } from "@/components/dashboard/realtime-refresh";
export const dynamic = "force-dynamic";

export default async function DashboardOverviewPage() {
  const { principal } = await ensureSetup();
  const [metrics, events] = await Promise.all([getMetrics(), getAuditEvents(30)]);
  const demoMode = process.env.NEXT_PUBLIC_DEMO_MODE === "true";

  return (
    <>
      <RealtimeRefresh
        userId={principal.id}
        tables={["action_intents", "approvals", "audit_events", "executions"]}
      />

      <header className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-2">
            <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">
              Give agents authority without giving them control.
            </h1>
            <p className="max-w-2xl text-muted-foreground">
              AgentLedger evaluates, approves, executes, and audits consequential AI-agent actions.
            </p>
            <p className="text-sm font-medium text-foreground/80">
              Agents propose. Policies decide. Humans stay in control.
            </p>
          </div>
          {demoMode ? <DemoResetButton /> : null}
        </div>
      </header>

      <section className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <MetricCard label="Actions evaluated" value={metrics.evaluated} />
        <MetricCard label="Actions blocked" value={metrics.blocked} />
        <MetricCard label="Human approvals" value={metrics.humanApprovals} />
        <MetricCard label="Transactions executed" value={metrics.executed} />
        <MetricCard
          label="Spend protected"
          value={formatCents(metrics.spendProtectedCents)}
          hint="Blocked intent amounts"
        />
        <MetricCard
          label="Duplicates blocked"
          value={metrics.duplicatesBlocked}
          className="sm:col-span-2 lg:col-span-1"
        />
      </section>

      <section className="mt-6 flex flex-wrap gap-2">
        <Link
          href="/dashboard/playground"
          className="inline-flex h-8 items-center justify-center gap-2 rounded-md border border-border bg-transparent px-3 text-xs font-medium transition-colors hover:bg-accent hover:text-accent-foreground"
        >
          <FlaskConical className="size-4" />
          Playground
        </Link>
        <Link
          href="/dashboard/approvals"
          className="inline-flex h-8 items-center justify-center gap-2 rounded-md border border-border bg-transparent px-3 text-xs font-medium transition-colors hover:bg-accent hover:text-accent-foreground"
        >
          <ClipboardCheck className="size-4" />
          Approvals
        </Link>
      </section>

      <section className="mt-8">
        <ActivityStream
          key={`${events.length}:${events[0]?.id ?? "none"}`}
          userId={principal.id}
          initialEvents={events}
        />
      </section>
    </>
  );
}

import { ensureSetup, getAuditEvents, getPendingApprovals } from "@/lib/data/queries";
import { LiveApprovals } from "@/components/approvals/live-approvals";
import { formatCents, formatDateTime } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";

export const dynamic = "force-dynamic";

export default async function ApprovalsPage() {
  const { principal } = await ensureSetup();
  const [pending, events] = await Promise.all([getPendingApprovals(), getAuditEvents(80)]);

  const recentResolved = events
    .filter((e) => e.event_type === "HUMAN_APPROVED" || e.event_type === "HUMAN_DENIED")
    .slice(0, 8);

  return (
    <div className="space-y-8">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">Approvals</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Review agent purchase proposals that passed policy but exceed your approval threshold. Your
          decision is recorded in the tamper-evident audit chain.
        </p>
      </header>

      <section className="space-y-3">
        <h2 className="text-sm font-medium text-muted-foreground">Pending</h2>
        <LiveApprovals userId={principal.id} initial={pending} />
      </section>

      {recentResolved.length > 0 ? (
        <section className="space-y-3">
          <h2 className="text-sm font-medium text-muted-foreground">Recently resolved</h2>
          <ul className="divide-y divide-border rounded-lg border border-border">
            {recentResolved.map((ev) => {
              const data = ev.event_data;
              const amount =
                typeof data.amount_cents === "number" ? formatCents(data.amount_cents) : null;
              const product = typeof data.product === "string" ? data.product : null;
              const approved = ev.event_type === "HUMAN_APPROVED";
              return (
                <li key={ev.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
                  <div className="min-w-0 space-y-0.5">
                    <p className="font-medium">
                      {product ?? "Purchase"}
                      {amount ? <span className="font-mono text-muted-foreground"> · {amount}</span> : null}
                    </p>
                    <p className="text-xs text-muted-foreground">{formatDateTime(ev.created_at)}</p>
                  </div>
                  <Badge variant={approved ? "emerald" : "neutral"}>
                    {approved ? "Approved" : "Denied"}
                  </Badge>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

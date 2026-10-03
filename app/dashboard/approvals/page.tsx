import { ensureSetup, getAuditEvents, getPendingApprovals } from "@/lib/data/queries";
import { LiveApprovals } from "@/components/approvals/live-approvals";
import { Eyebrow } from "@/components/brand/eyebrow";
import { cn, formatCents } from "@/lib/utils";
import { LocalDateTime } from "@/components/local-time";

export const dynamic = "force-dynamic";

export default async function ApprovalsPage() {
  const { principal } = await ensureSetup();
  const [pending, events] = await Promise.all([getPendingApprovals(), getAuditEvents(80)]);

  const recentResolved = events
    .filter((e) => e.event_type === "HUMAN_APPROVED" || e.event_type === "HUMAN_DENIED")
    .slice(0, 8);

  return (
    <div className="w-full max-w-full space-y-8 overflow-x-hidden sm:space-y-12">
      <header className="space-y-3 sm:space-y-4">
        <Eyebrow>Approvals</Eyebrow>
        <h1 className="font-display text-[32px] font-semibold leading-[0.95] tracking-[-0.045em] text-ink sm:text-[44px] md:text-[56px]">
          Your <span className="text-accent">decision</span>, on the record.
        </h1>
        <p className="max-w-2xl text-[15px] leading-relaxed text-ink-2">
          Review agent purchase proposals that passed policy but exceed your approval threshold. Your
          decision is recorded in the tamper-evident audit chain.
        </p>
      </header>

      <section className="w-full min-w-0 space-y-4">
        <div className="flex items-baseline justify-between gap-4">
          <h2 className="font-display text-xl font-semibold tracking-[-0.03em] text-ink sm:text-2xl">
            Pending
          </h2>
          <span className="font-mono text-xs text-ink-3">{pending.length} open</span>
        </div>
        <LiveApprovals userId={principal.id} initial={pending} mobilePresenter resolvedHoldMs={4000} />
      </section>

      {recentResolved.length > 0 ? (
        <section className="space-y-4">
          <h2 className="font-display text-2xl font-semibold tracking-[-0.03em] text-ink">
            Recently resolved
          </h2>
          <ul className="divide-y divide-line rounded-[6px] border border-line bg-surface">
            {recentResolved.map((ev) => {
              const data = ev.event_data;
              const amount =
                typeof data.amount_cents === "number" ? formatCents(data.amount_cents) : null;
              const product = typeof data.product === "string" ? data.product : null;
              const approved = ev.event_type === "HUMAN_APPROVED";
              return (
                <li
                  key={ev.id}
                  className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 text-[15px]"
                >
                  <div className="min-w-0 space-y-1">
                    <p className="font-medium text-ink">
                      {product ?? "Purchase"}
                      {amount ? <span className="font-mono text-ink-2"> · {amount}</span> : null}
                    </p>
                    <LocalDateTime iso={ev.created_at} className="font-mono text-xs text-ink-3" />
                  </div>
                  <span
                    className={cn(
                      "inline-flex items-center rounded-[4px] px-2 py-1 text-[11px] font-semibold uppercase tracking-[0.08em]",
                      approved ? "bg-executed-bg text-executed" : "bg-[#F2F2F2] text-ink-2",
                    )}
                  >
                    {approved ? "Approved" : "Denied"}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

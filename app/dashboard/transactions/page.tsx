import Link from "next/link";
import { FlaskConical } from "lucide-react";
import {
  ensureSetup,
  getAgents,
  getIntents,
} from "@/lib/data/queries";
import { RealtimeRefresh } from "@/components/dashboard/realtime-refresh";
import { StatusBadge, DecisionBadge } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { Eyebrow } from "@/components/brand/eyebrow";
import { ArrowButton } from "@/components/brand/arrow-button";
import { formatCents } from "@/lib/utils";
import { LocalTime } from "@/components/local-time";
import type { IntentStatus } from "@/lib/ledger/state-machine";

export const dynamic = "force-dynamic";

export default async function TransactionsPage() {
  const { principal } = await ensureSetup();
  const [intents, agents] = await Promise.all([getIntents(), getAgents()]);
  const agentNames = new Map(agents.map((a) => [a.id, a.name]));

  return (
    <div className="space-y-10">
      <RealtimeRefresh
        userId={principal.id}
        tables={["action_intents", "approvals", "executions", "audit_events"]}
      />

      <header className="space-y-4">
        <Eyebrow>Transactions</Eyebrow>
        <h1 className="font-display text-[44px] font-semibold leading-[0.95] tracking-[-0.045em] text-ink md:text-[56px]">
          Every action, <span className="text-accent">accounted</span> for.
        </h1>
        <p className="max-w-2xl text-[15px] leading-relaxed text-ink-2">
          Every agent purchase proposal, policy outcome, and execution — linked to the tamper-evident
          audit chain.
        </p>
      </header>

      {intents.length === 0 ? (
        <div className="flex flex-col items-center gap-5 rounded-[6px] border border-line bg-surface px-6 py-16 text-center">
          <FlaskConical className="size-6 text-accent" aria-hidden />
          <p className="text-[15px] text-ink-2">No transactions yet.</p>
          <ArrowButton href="/dashboard/playground">Open Playground</ArrowButton>
        </div>
      ) : (
        <div className="overflow-hidden rounded-[6px] border border-line bg-surface">
          <Table>
            <THead>
              <TR>
                <TH>Time</TH>
                <TH>Agent</TH>
                <TH>Action</TH>
                <TH>Amount</TH>
                <TH>Status</TH>
                <TH>Policy</TH>
              </TR>
            </THead>
            <TBody>
              {intents.map((intent) => {
                const product =
                  typeof intent.payload.product_name === "string"
                    ? intent.payload.product_name
                    : intent.action_type;
                const merchant =
                  typeof intent.payload.merchant_name === "string"
                    ? intent.payload.merchant_name
                    : intent.merchant_slug;
                const violationCount = intent.decision?.violations.length ?? 0;

                return (
                  <TR key={intent.id} className="group">
                    <TD className="py-5 font-mono text-xs tabular-nums text-ink-3">
                      <Link href={`/dashboard/transactions/${intent.id}`} className="block">
                        <LocalTime iso={intent.created_at} className="block" />
                      </Link>
                    </TD>
                    <TD className="py-5">
                      <Link href={`/dashboard/transactions/${intent.id}`} className="block text-sm text-ink-2">
                        {agentNames.get(intent.agent_id) ?? "Agent"}
                      </Link>
                    </TD>
                    <TD className="py-5">
                      <Link href={`/dashboard/transactions/${intent.id}`} className="block min-w-0">
                        <span className="font-medium text-ink group-hover:text-accent">{product}</span>
                        <span className="text-ink-3"> · {merchant}</span>
                        {intent.recurring ? (
                          <Badge variant="amber" className="ml-2 align-middle">
                            recurring
                          </Badge>
                        ) : null}
                      </Link>
                    </TD>
                    <TD className="py-5 font-mono text-sm font-medium tabular-nums text-ink">
                      <Link href={`/dashboard/transactions/${intent.id}`} className="block">
                        {formatCents(intent.amount_cents, intent.currency)}
                      </Link>
                    </TD>
                    <TD className="py-5">
                      <Link href={`/dashboard/transactions/${intent.id}`} className="block">
                        <StatusBadge status={intent.status as IntentStatus} />
                      </Link>
                    </TD>
                    <TD className="py-5">
                      <Link href={`/dashboard/transactions/${intent.id}`} className="flex flex-wrap items-center gap-2">
                        {intent.decision ? (
                          <DecisionBadge decision={intent.decision.decision} />
                        ) : (
                          <span className="text-xs text-ink-3">—</span>
                        )}
                        {violationCount > 0 ? (
                          <span className="font-mono text-xs text-blocked">
                            {violationCount} violation{violationCount === 1 ? "" : "s"}
                          </span>
                        ) : null}
                      </Link>
                    </TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
        </div>
      )}
    </div>
  );
}

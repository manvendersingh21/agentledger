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
import { formatCents, formatTime } from "@/lib/utils";
import type { IntentStatus } from "@/lib/ledger/state-machine";

export const dynamic = "force-dynamic";

export default async function TransactionsPage() {
  const { principal } = await ensureSetup();
  const [intents, agents] = await Promise.all([getIntents(), getAgents()]);
  const agentNames = new Map(agents.map((a) => [a.id, a.name]));

  return (
    <div className="space-y-6">
      <RealtimeRefresh
        userId={principal.id}
        tables={["action_intents", "approvals", "executions", "audit_events"]}
      />

      <header className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">Transactions</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Every agent purchase proposal, policy outcome, and execution — linked to the tamper-evident
          audit chain.
        </p>
      </header>

      {intents.length === 0 ? (
        <div className="rounded-lg border border-border bg-muted/20 px-6 py-12 text-center">
          <p className="text-sm text-muted-foreground">No transactions yet.</p>
          <Link
            href="/dashboard/playground"
            className="mt-4 inline-flex h-9 items-center justify-center gap-2 rounded-md border border-border bg-transparent px-4 text-sm font-medium transition-colors hover:bg-accent"
          >
            <FlaskConical className="size-4" />
            Open Playground
          </Link>
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-border bg-card">
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
                    <TD className="font-mono text-xs tabular-nums text-muted-foreground">
                      <Link href={`/dashboard/transactions/${intent.id}`} className="block">
                        {formatTime(intent.created_at)}
                      </Link>
                    </TD>
                    <TD>
                      <Link href={`/dashboard/transactions/${intent.id}`} className="block text-sm">
                        {agentNames.get(intent.agent_id) ?? "Agent"}
                      </Link>
                    </TD>
                    <TD>
                      <Link href={`/dashboard/transactions/${intent.id}`} className="block min-w-0">
                        <span className="font-medium text-foreground">{product}</span>
                        <span className="text-muted-foreground"> · {merchant}</span>
                        {intent.recurring ? (
                          <Badge variant="amber" className="ml-2 align-middle">
                            recurring
                          </Badge>
                        ) : null}
                      </Link>
                    </TD>
                    <TD className="font-mono text-sm tabular-nums">
                      <Link href={`/dashboard/transactions/${intent.id}`} className="block">
                        {formatCents(intent.amount_cents, intent.currency)}
                      </Link>
                    </TD>
                    <TD>
                      <Link href={`/dashboard/transactions/${intent.id}`} className="block">
                        <StatusBadge status={intent.status as IntentStatus} />
                      </Link>
                    </TD>
                    <TD>
                      <Link href={`/dashboard/transactions/${intent.id}`} className="flex flex-wrap items-center gap-2">
                        {intent.decision ? (
                          <DecisionBadge decision={intent.decision.decision} />
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                        {violationCount > 0 ? (
                          <span className="text-xs text-red-400">
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

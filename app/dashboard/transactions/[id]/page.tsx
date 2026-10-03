import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ShieldAlert, ShieldCheck } from "lucide-react";
import {
  ensureSetup,
  getAuditVerification,
  getContextEvents,
  getIntentDetail,
} from "@/lib/data/queries";
import { RealtimeRefresh } from "@/components/dashboard/realtime-refresh";
import { IntegrityBadge } from "@/components/audit/integrity-badge";
import { CausalTimeline } from "@/components/timeline/causal-timeline";
import { StatusBadge } from "@/components/status-badge";
import { RetryButton } from "@/app/dashboard/transactions/[id]/retry-button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { CodeBlock } from "@/components/ui/code-block";
import { Badge } from "@/components/ui/badge";
import { formatCents, formatDateTime } from "@/lib/utils";
import type { IntentStatus } from "@/lib/ledger/state-machine";

export const dynamic = "force-dynamic";

export default async function TransactionDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { principal, paymentProviderLabel } = await ensureSetup();
  const [detail, verification] = await Promise.all([getIntentDetail(id), getAuditVerification()]);

  if (!detail) notFound();

  const contextEvents = await getContextEvents(detail.intent.created_at);

  const { intent, agent, delegation, execution, receipt, events, decisions } = detail;
  const decision = decisions.at(-1) ?? null;
  const product =
    typeof intent.payload.product_name === "string"
      ? intent.payload.product_name
      : intent.action_type;
  const merchantName =
    typeof intent.payload.merchant_name === "string"
      ? intent.payload.merchant_name
      : intent.merchant_slug;
  const merchantTrusted = intent.payload.merchant_trusted === true;

  return (
    <div className="space-y-6">
      <RealtimeRefresh
        userId={principal.id}
        tables={["action_intents", "approvals", "executions", "receipts", "audit_events"]}
      />

      <div className="flex flex-wrap items-center gap-3">
        <Link
          href="/dashboard/transactions"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          Transactions
        </Link>
      </div>

      <IntegrityBadge
        valid={verification.valid}
        verifiedCount={verification.verifiedCount}
        brokenAt={verification.brokenAt}
        reason={verification.reason}
      />

      <header className="flex flex-col gap-4 border-b border-border pb-6 lg:flex-row lg:items-start lg:justify-between">
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={intent.status as IntentStatus} />
            {intent.recurring ? <Badge variant="amber">recurring</Badge> : null}
          </div>
          <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">{product}</h1>
          <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            {merchantTrusted ? (
              <span className="inline-flex items-center gap-1 text-emerald-400/90">
                <ShieldCheck className="size-3.5" />
                Trusted merchant
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-amber-400/90">
                <ShieldAlert className="size-3.5" />
                Untrusted merchant
              </span>
            )}
            <span>·</span>
            <span>{merchantName}</span>
            {agent ? <span>· {agent.name}</span> : null}
          </div>
          <p className="font-mono text-3xl font-semibold tabular-nums tracking-tight">
            {formatCents(intent.amount_cents, intent.currency)}
          </p>
          <p className="font-mono text-xs text-muted-foreground">
            {intent.id} · {formatDateTime(intent.created_at)}
          </p>
        </div>
      </header>

      <div className="grid gap-8 lg:grid-cols-[1fr_320px]">
        <section className="space-y-4">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Causal timeline
          </h2>
          <CausalTimeline
            input={{
              delegation,
              contextEvents,
              intentEvents: events,
              intent,
              decision,
              principalDisplayName: principal.displayName,
              paymentProviderLabel,
            }}
          />
        </section>

        <aside className="space-y-4">
          {intent.status === "executed" ? (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Idempotency</CardTitle>
                <CardDescription>Safe to retry — duplicate charges are blocked.</CardDescription>
              </CardHeader>
              <CardContent>
                <RetryButton intentId={intent.id} />
              </CardContent>
            </Card>
          ) : null}

          {receipt ? (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Receipt</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <p className="font-mono text-xs text-muted-foreground">{receipt.id}</p>
                <p className="font-mono tabular-nums">
                  {formatCents(receipt.amount_cents, receipt.currency)}
                </p>
                <p className="text-xs text-muted-foreground">
                  {receipt.provider} · {receipt.provider_reference}
                </p>
              </CardContent>
            </Card>
          ) : null}

          {execution ? (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Execution</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <p className="font-mono text-xs">{execution.id}</p>
                <p className="capitalize text-foreground/90">{execution.status}</p>
                <p className="text-xs text-muted-foreground">
                  {execution.provider}
                  {execution.provider_operation_id
                    ? ` · ${execution.provider_operation_id}`
                    : null}
                </p>
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Intent payload</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <CodeBlock value={intent.payload} title="Payload" />
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Idempotency key
                </p>
                <p className="mt-1 break-all font-mono text-xs">{intent.idempotency_key}</p>
              </div>
            </CardContent>
          </Card>
        </aside>
      </div>
    </div>
  );
}

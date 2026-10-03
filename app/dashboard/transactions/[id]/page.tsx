import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ShieldAlert, ShieldCheck } from "lucide-react";
import {
  ensureSetup,
  getAuditVerification,
  getContextEvents,
  getIntentDetail,
  getIntents,
} from "@/lib/data/queries";
import { RealtimeRefresh } from "@/components/dashboard/realtime-refresh";
import { IntegrityBadge } from "@/components/audit/integrity-badge";
import { CausalTimeline } from "@/components/timeline/causal-timeline";
import { StatusBadge } from "@/components/status-badge";
import { RetryButton } from "@/app/dashboard/transactions/[id]/retry-button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { CodeBlock } from "@/components/ui/code-block";
import { Badge } from "@/components/ui/badge";
import { Eyebrow } from "@/components/brand/eyebrow";
import { formatCents } from "@/lib/utils";
import { LocalDateTime } from "@/components/local-time";
import type { IntentStatus } from "@/lib/ledger/state-machine";

export const dynamic = "force-dynamic";

/** Context events older than this (relative to the intent) are never part of the same agent run. */
const CONTEXT_WINDOW_MS = 3 * 60_000;

export default async function TransactionDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { principal, paymentProviderLabel } = await ensureSetup();
  const [detail, verification] = await Promise.all([getIntentDetail(id), getAuditVerification()]);

  if (!detail) notFound();

  const intentCreatedMs = new Date(detail.intent.created_at).getTime();
  const [rawContextEvents, recentIntents] = await Promise.all([
    getContextEvents(detail.intent.created_at),
    getIntents(),
  ]);
  // Limit context to this agent run: after the previous intent of the same principal,
  // or within 3 minutes before this intent — whichever is later.
  const previousIntentMs = recentIntents
    .filter((i) => i.principal_id === detail.intent.principal_id && i.id !== detail.intent.id)
    .map((i) => new Date(i.created_at).getTime())
    .filter((ms) => ms < intentCreatedMs)
    .reduce((max, ms) => Math.max(max, ms), Number.NEGATIVE_INFINITY);
  const contextFromMs = Math.max(previousIntentMs, intentCreatedMs - CONTEXT_WINDOW_MS);
  const contextEvents = rawContextEvents.filter(
    (e) =>
      e.principal_id === detail.intent.principal_id &&
      (e.agent_id === null || e.agent_id === detail.intent.agent_id) &&
      new Date(e.created_at).getTime() > contextFromMs,
  );

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
    <div className="space-y-10">
      <RealtimeRefresh
        userId={principal.id}
        tables={["action_intents", "approvals", "executions", "receipts", "audit_events"]}
      />

      <div className="flex flex-wrap items-center justify-between gap-4">
        <Link
          href="/dashboard/transactions"
          className="group inline-flex items-center gap-1.5 text-sm text-ink-2 transition-colors hover:text-ink"
        >
          <ArrowLeft className="size-4 transition-transform group-hover:-translate-x-0.5" />
          Transactions
        </Link>
        <IntegrityBadge
          valid={verification.valid}
          verifiedCount={verification.verifiedCount}
          brokenAt={verification.brokenAt}
          reason={verification.reason}
        />
      </div>

      <header className="rounded-[6px] border border-line bg-surface p-6 md:p-10">
        <div className="flex flex-col gap-8 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0 space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <Eyebrow>Transaction</Eyebrow>
              <StatusBadge status={intent.status as IntentStatus} />
              {intent.recurring ? <Badge variant="amber">recurring</Badge> : null}
            </div>
            <h1 className="font-display text-[40px] font-semibold leading-[0.95] tracking-[-0.045em] text-ink md:text-[56px]">
              {product}
            </h1>
            <div className="flex flex-wrap items-center gap-2 text-sm text-ink-2">
              {merchantTrusted ? (
                <span className="inline-flex items-center gap-1 text-executed">
                  <ShieldCheck className="size-3.5" />
                  Trusted merchant
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 text-waiting">
                  <ShieldAlert className="size-3.5" />
                  Untrusted merchant
                </span>
              )}
              <span className="text-ink-3">·</span>
              <span>{merchantName}</span>
              {agent ? (
                <>
                  <span className="text-ink-3">·</span>
                  <span>{agent.name}</span>
                </>
              ) : null}
            </div>
          </div>
          <div className="shrink-0 lg:text-right">
            <p className="font-mono text-5xl font-semibold tabular-nums tracking-[-0.04em] text-ink md:text-7xl">
              {formatCents(intent.amount_cents, intent.currency)}
            </p>
            <p className="mt-3 break-all font-mono text-xs text-ink-3">
              {intent.id} · <LocalDateTime iso={intent.created_at} />
            </p>
          </div>
        </div>
      </header>

      <div className="grid gap-8 lg:grid-cols-[1fr_340px]">
        <section className="rounded-[6px] border border-line bg-surface p-6 md:p-8">
          <div className="mb-8 space-y-2">
            <Eyebrow>Causal timeline</Eyebrow>
            <h2 className="font-display text-2xl font-semibold tracking-[-0.03em] text-ink">
              From delegation to settlement
            </h2>
          </div>
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
          {receipt ? (
            <div className="rounded-[6px] bg-inverse p-6 text-white">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/60">
                Receipt
              </p>
              <p className="mt-4 font-mono text-4xl font-semibold tabular-nums tracking-[-0.03em]">
                {formatCents(receipt.amount_cents, receipt.currency)}
              </p>
              <dl className="mt-6 space-y-3 border-t border-white/15 pt-4 text-xs">
                <div>
                  <dt className="text-white/50">Receipt ID</dt>
                  <dd className="mt-0.5 break-all font-mono text-white/90">{receipt.id}</dd>
                </div>
                <div>
                  <dt className="text-white/50">Provider</dt>
                  <dd className="mt-0.5 break-all font-mono text-white/90">
                    {receipt.provider} · {receipt.provider_reference}
                  </dd>
                </div>
              </dl>
            </div>
          ) : null}

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

          {execution ? (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Execution</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <p className="break-all font-mono text-xs text-ink-2">{execution.id}</p>
                <p className="capitalize text-ink">{execution.status}</p>
                <p className="break-all font-mono text-xs text-ink-3">
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
            <CardContent className="space-y-4">
              <CodeBlock value={intent.payload} title="Payload" />
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-3">
                  Idempotency key
                </p>
                <p className="mt-1 break-all font-mono text-xs text-ink">{intent.idempotency_key}</p>
              </div>
            </CardContent>
          </Card>
        </aside>
      </div>
    </div>
  );
}

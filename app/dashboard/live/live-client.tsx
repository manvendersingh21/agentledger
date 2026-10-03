"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { ArrowLeft, Radio, RotateCw } from "lucide-react";
import { PipelineGraph } from "@/components/live/pipeline-graph";
import type { LivePipelineData, LivePipelineSnapshot } from "@/lib/data/live";
import { useLedgerRealtime, type LedgerChange } from "@/lib/realtime/use-ledger-realtime";

const WATCHED_TABLES: LedgerChange["table"][] = [
  "audit_events",
  "action_intents",
  "approvals",
  "executions",
  "receipts",
];

function formatMoney(cents: number, currency: string): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency.toUpperCase(),
    minimumFractionDigits: 2,
  }).format(cents / 100);
}

function shortId(value: string): string {
  return value.length > 12 ? `${value.slice(0, 8)}…` : value;
}

function selectorLabel(
  productName: string,
  amountCents: number,
  currency: string,
  id: string,
): string {
  return `${productName} · ${formatMoney(amountCents, currency)} · ${shortId(id)}`;
}

function isLivePipelineData(value: unknown): value is LivePipelineData {
  return (
    typeof value === "object" &&
    value !== null &&
    "userId" in value &&
    typeof value.userId === "string" &&
    "intents" in value &&
    Array.isArray(value.intents) &&
    "snapshot" in value
  );
}

function narration(snapshot: LivePipelineSnapshot | null): string {
  if (!snapshot) {
    return "Waiting for an agent to propose an action. No money can move without a recorded intent.";
  }

  const amount = formatMoney(snapshot.intent.amountCents, snapshot.intent.currency);
  const failedRules = snapshot.policy?.rules.filter((rule) => !rule.passed).length ?? 0;
  const injection = snapshot.jev.promptInjection;

  if (!snapshot.policy) {
    return `${snapshot.agent.name} proposed ${snapshot.intent.productName} for ${amount}; authoritative terms are recorded and deterministic checks are running.`;
  }

  if (snapshot.policy.decision === "deny") {
    const signalLead =
      injection !== null && injection >= 0.8
        ? `Jev scored this listing ${injection.toFixed(2)} for prompt injection; `
        : "";
    return `${signalLead}policy denied: ${failedRules} ${failedRules === 1 ? "rule failed" : "rules failed"}. No money moved.`;
  }

  if (snapshot.approval?.status === "pending") {
    return `Policy requires a hash-bound human approval for ${amount}; execution is paused. No money moved.`;
  }

  if (snapshot.approval?.status === "denied" || snapshot.approval?.status === "expired") {
    return `The human ${snapshot.approval.status === "denied" ? "denied" : "did not approve"} this exact intent. No money moved.`;
  }

  if (snapshot.execution?.status === "failed" || snapshot.status === "failed") {
    return `The policy path passed, but Stripe test execution failed. No receipt was issued.`;
  }

  if (snapshot.receipt) {
    return `Stripe test execution succeeded for ${amount}; a receipt was issued and the audit chain is ${snapshot.audit.verified ? "verified" : "not verified"}.`;
  }

  if (snapshot.execution?.status === "pending" || snapshot.status === "executing") {
    return `Authorization is complete and Stripe test execution is in progress for ${amount}.`;
  }

  if (snapshot.policy.decision === "auto_approve") {
    return `Every deterministic rule passed; ${amount} qualified for automatic test execution.`;
  }

  return `The human approved the hash-bound ${amount} intent; AgentLedger is preparing test execution.`;
}

export function LiveClient({
  initial,
  pinnedIntentId,
}: {
  initial: LivePipelineData;
  pinnedIntentId: string | null;
}) {
  const router = useRouter();
  const [data, setData] = useState(initial);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isNavigating, startTransition] = useTransition();
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestNumber = useRef(0);

  useEffect(
    () => () => {
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
    },
    [],
  );

  const refresh = useCallback(async () => {
    const currentRequest = ++requestNumber.current;
    setRefreshing(true);
    try {
      const query = pinnedIntentId ? `?intent=${encodeURIComponent(pinnedIntentId)}` : "";
      const response = await fetch(`/dashboard/live/data${query}`, {
        cache: "no-store",
        headers: { Accept: "application/json" },
      });
      if (!response.ok) throw new Error("Live update failed");
      const payload: unknown = await response.json();
      if (!isLivePipelineData(payload)) throw new Error("Live update was malformed");
      if (currentRequest === requestNumber.current) {
        setData(payload);
        setError(null);
      }
    } catch {
      if (currentRequest === requestNumber.current) {
        setError("Reconnecting…");
      }
    } finally {
      if (currentRequest === requestNumber.current) setRefreshing(false);
    }
  }, [pinnedIntentId]);

  const onLedgerChange = useCallback(
    (change: LedgerChange) => {
      if (!WATCHED_TABLES.includes(change.table)) return;
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
      refreshTimer.current = setTimeout(() => {
        void refresh();
      }, 40);
    },
    [refresh],
  );

  useLedgerRealtime(data.userId, onLedgerChange);

  const selectIntent = (intentId: string) => {
    const href = intentId ? `/dashboard/live?intent=${encodeURIComponent(intentId)}` : "/dashboard/live";
    startTransition(() => router.push(href));
  };

  const snapshot = data.snapshot;

  return (
    <div className="fixed inset-0 z-[60] flex min-h-dvh flex-col overflow-hidden bg-canvas text-ink">
      <header className="shrink-0 border-b border-line bg-surface px-3 py-3 sm:px-5 lg:px-8">
        <div className="mx-auto flex max-w-[1920px] flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-center gap-3">
            <Link
              href="/dashboard"
              className="inline-flex size-10 shrink-0 items-center justify-center rounded-[4px] border border-line bg-surface text-ink transition-colors hover:border-ink"
              aria-label="Back to dashboard"
            >
              <ArrowLeft className="size-4" />
            </Link>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <Radio className="size-4 shrink-0 text-accent" aria-hidden />
                <h1 className="truncate font-display text-[24px] font-semibold leading-none tracking-[-0.04em] sm:text-[30px]">
                  Live: watching your <span className="text-accent">agent</span>
                </h1>
              </div>
              <p className="mt-1 flex items-center gap-2 text-xs text-ink-3">
                <span className="relative flex size-2" aria-hidden>
                  <span className="absolute inline-flex size-full animate-ping rounded-full bg-accent opacity-30" />
                  <span className="relative inline-flex size-2 rounded-full bg-accent" />
                </span>
                {error ?? (refreshing ? "Receiving ledger update…" : "Private realtime ledger feed")}
              </p>
            </div>
          </div>

          <div className="flex min-w-0 items-center gap-2">
            <label htmlFor="live-intent" className="sr-only">
              Select one of the last ten intents
            </label>
            <select
              id="live-intent"
              value={data.selectedIntentId ?? ""}
              onChange={(event) => selectIntent(event.target.value)}
              disabled={isNavigating || data.intents.length === 0}
              className="h-10 min-w-0 flex-1 rounded-[4px] border border-line bg-surface px-3 font-mono text-xs text-ink outline-none focus:border-accent sm:w-[360px]"
            >
              {data.intents.length === 0 ? <option value="">No intents yet</option> : null}
              {data.intents.map((intent) => (
                <option key={intent.id} value={intent.id}>
                  {selectorLabel(
                    intent.productName,
                    intent.amountCents,
                    intent.currency,
                    intent.id,
                  )}
                </option>
              ))}
            </select>
            {pinnedIntentId ? (
              <button
                type="button"
                onClick={() => selectIntent("")}
                className="inline-flex h-10 shrink-0 items-center gap-2 rounded-[4px] bg-accent px-3 text-xs font-semibold text-white transition-colors hover:bg-accent-hover"
              >
                <RotateCw className="size-3.5" />
                <span className="hidden sm:inline">Follow latest</span>
              </button>
            ) : (
              <span className="hidden h-10 items-center rounded-[4px] bg-accent-wash px-3 text-[10px] font-semibold uppercase tracking-[0.12em] text-accent sm:inline-flex">
                Following latest
              </span>
            )}
          </div>
        </div>
      </header>

      <main className="min-h-0 flex-1 overflow-auto px-3 py-4 sm:px-5 lg:px-8 lg:py-6">
        <div className="mx-auto h-full max-w-[1920px]">
          {snapshot ? (
            <PipelineGraph snapshot={snapshot} />
          ) : (
            <div className="flex min-h-full items-center justify-center">
              <div className="max-w-xl rounded-[6px] border border-line bg-surface p-8 text-center sm:p-12">
                <span className="mx-auto flex size-12 items-center justify-center rounded-full bg-accent-wash">
                  <Radio className="size-5 text-accent" />
                </span>
                <h2 className="mt-6 font-display text-4xl font-semibold tracking-[-0.045em] text-ink">
                  Ready for the next action.
                </h2>
                <p className="mt-3 text-[15px] leading-relaxed text-ink-2">
                  Open Concierge, Playground, MCP, or Autopilot and propose a purchase. Each stage will
                  appear here as it is committed to the ledger.
                </p>
              </div>
            </div>
          )}
        </div>
      </main>

      <footer className="shrink-0 border-t border-line bg-inverse px-4 py-4 text-white sm:px-8">
        <div className="mx-auto flex max-w-[1920px] items-start gap-3 sm:items-center">
          <span className="mt-1 size-2 shrink-0 animate-pulse rounded-full bg-accent-soft sm:mt-0" aria-hidden />
          <p className="font-display text-[17px] font-semibold leading-snug tracking-[-0.02em] sm:text-[20px]" aria-live="polite">
            {narration(snapshot)}
          </p>
          {snapshot ? (
            <span className="ml-auto hidden shrink-0 font-mono text-[10px] text-white/45 xl:block">
              {shortId(snapshot.id)} · {snapshot.status.replaceAll("_", " ")}
            </span>
          ) : null}
        </div>
      </footer>
    </div>
  );
}

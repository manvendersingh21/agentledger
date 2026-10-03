"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  AlertTriangle,
  ArrowUpRight,
  CheckCircle2,
  Clock,
  Loader2,
  OctagonAlert,
  ShieldBan,
  Sparkles,
} from "lucide-react";
import type { AgentActivity } from "@/lib/agent/types";
import type { DelegationRow, PendingApproval } from "@/lib/data/types";
import type { AnyViolation, AuthoritativeTerms, ProposeResult } from "@/lib/domain/pipeline";
import type { RiskSignals } from "@/lib/domain/guardrail-gate";
import type { ExecuteResult } from "@/lib/domain/pipeline";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { ArrowButton } from "@/components/brand/arrow-button";
import { LiveApprovals } from "@/components/approvals/live-approvals";
import type { ApprovalResolveResponse } from "@/components/approvals/approval-card";
import { useLedgerRealtime } from "@/lib/realtime/use-ledger-realtime";
import { cn, formatCents } from "@/lib/utils";

const DEFAULT_PROMPT =
  "Find me the cheapest API plan that gives me at least 100,000 requests for under $20 and buy one month. Do not start a subscription.";

interface ProductSearchOutput {
  products?: Array<{
    product_id: string;
    name: string;
    suspicious_content_detected?: boolean;
    merchant?: {
      slug: string;
      name: string;
      trusted: boolean;
      domain?: string | null;
      trust_score?: number | null;
      trust_score_source?: string;
      verified?: boolean;
    };
    untrusted_merchant_content?: { description: string };
  }>;
}

function trustSourceLabel(source: string | undefined): string {
  if (source === "fixture") return "demo fixture";
  if (source === "scamadvisor") return "ScamAdviser";
  return source ?? "unknown";
}

function JevSignalBars({ risk }: { risk: RiskSignals }) {
  const signals = [
    { key: "injection", label: "injection", value: risk.promptInjection },
    { key: "price", label: "price anomaly", value: risk.priceAnomaly },
    { key: "crypto", label: "crypto", value: risk.cryptoExfiltration },
  ] as const;
  return (
    <div className="space-y-3 rounded-[4px] border border-white/10 bg-white/[0.03] p-4">
      <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-white/60">
        Jev signals:{" "}
        <span className="font-mono normal-case tracking-normal text-white/80">
          {signals.map((s, i) => (
            <span key={s.key}>
              {i > 0 ? " · " : null}
              {s.label} {s.value.toFixed(2)}
            </span>
          ))}
        </span>
      </p>
      <div className="space-y-2">
        {signals.map((s) => (
          <div key={s.key} className="flex items-center gap-3 text-xs">
            <span className="w-28 shrink-0 font-mono text-white/60">{s.label}</span>
            <div className="h-2 flex-1 overflow-hidden rounded-[2px] bg-white/10">
              <div
                className="h-full rounded-[2px] bg-blocked"
                style={{ width: `${Math.min(100, Math.max(0, s.value * 100))}%` }}
              />
            </div>
            <span className="w-10 shrink-0 text-right font-mono tabular-nums text-white">
              {s.value.toFixed(2)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function TimelineLink({ intentId, inverse }: { intentId: string; inverse?: boolean }) {
  return (
    <Link
      href={`/dashboard/transactions/${intentId}`}
      className={cn(
        "group inline-flex items-center gap-1.5 text-xs font-medium",
        inverse ? "text-white hover:text-accent-soft" : "text-accent hover:text-accent-hover",
      )}
    >
      Open transaction timeline
      <ArrowUpRight className="size-3.5 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
    </Link>
  );
}

function SimulatedCompromiseTag() {
  return (
    <span className="rounded-[4px] bg-blocked-bg px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-blocked">
      Simulated compromise
    </span>
  );
}

function StepCard({
  icon,
  label,
  tone = "neutral",
  simulated,
  children,
}: {
  icon: ReactNode;
  label: string;
  tone?: "neutral" | "accent" | "waiting" | "blocked";
  simulated?: boolean;
  children?: ReactNode;
}) {
  return (
    <div className="rounded-[6px] border border-line bg-surface px-4 py-3.5">
      <p className="flex flex-wrap items-center gap-3 text-sm font-medium text-ink">
        <span
          className={cn(
            "flex size-7 shrink-0 items-center justify-center rounded-[4px]",
            tone === "accent" && "bg-accent-wash text-accent",
            tone === "neutral" && "bg-executed-bg text-executed",
            tone === "waiting" && "bg-waiting-bg text-waiting",
            tone === "blocked" && "bg-blocked-bg text-blocked",
          )}
        >
          {icon}
        </span>
        <span className="flex flex-wrap items-center gap-2">
          <span>{label}</span>
          {simulated ? <SimulatedCompromiseTag /> : null}
        </span>
      </p>
      {children ? <div className="mt-3 pl-10">{children}</div> : null}
    </div>
  );
}


function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function asProposeResult(output: unknown): ProposeResult | null {
  if (!isRecord(output) || typeof output.status !== "string") return null;
  return output as ProposeResult;
}

function delegationStrip(d: DelegationRow): string {
  const subs = d.allow_recurring ? "subscriptions allowed" : "no subscriptions";
  const n = d.allowed_merchants.length;
  return `${formatCents(d.max_amount_cents)} max • ${formatCents(d.daily_limit_cents)}/day • approval above ${formatCents(d.approval_threshold_cents)} • ${subs} • ${n} merchant${n === 1 ? "" : "s"}`;
}

interface FeedItem {
  id: string;
  kind: "status" | "delegation" | "search" | "untrusted" | "propose" | "text" | "error" | "halt";
  activity?: AgentActivity;
  propose?: ProposeResult;
  searchProducts?: ProductSearchOutput["products"];
  searchCount?: number;
  untrustedExcerpt?: string;
  haltReason?: string;
  simulated?: boolean;
}

function isSimulatedToolResult(a: AgentActivity): boolean {
  return a.type === "tool_result" && a.simulated === true;
}

function buildFeedItems(activities: AgentActivity[]): FeedItem[] {
  const items: FeedItem[] = [];
  let halted = false;

  for (const a of activities) {
    if (halted) break;

    if (a.type === "tool_result") {
      if (a.tool === "list_delegations") {
        items.push({ id: a.id, kind: "delegation", activity: a, simulated: isSimulatedToolResult(a) });
      }
      if (a.tool === "search_products") {
        const out = a.output as ProductSearchOutput;
        const products = out.products ?? [];
        items.push({
          id: a.id,
          kind: "search",
          activity: a,
          searchCount: products.length,
          searchProducts: products,
          simulated: isSimulatedToolResult(a),
        });
        const suspicious = products.filter(
          (p) => p.suspicious_content_detected || p.merchant?.trusted === false,
        );
        if (suspicious.length > 0) {
          const excerpt =
            suspicious[0]?.untrusted_merchant_content?.description?.slice(0, 200) ??
            "Untrusted merchant content detected in search results.";
          items.push({
            id: `${a.id}-untrusted`,
            kind: "untrusted",
            untrustedExcerpt: excerpt,
          });
        }
      }
      if (a.tool === "propose_purchase") {
        const propose = asProposeResult(a.output);
        if (propose) {
          items.push({ id: a.id, kind: "propose", propose, activity: a, simulated: isSimulatedToolResult(a) });
          const denied = asDeniedPropose(propose);
          if (denied?.kill_switch?.triggered) {
            items.push({
              id: `${a.id}-halt`,
              kind: "halt",
              haltReason: denied.kill_switch.reason ?? "Kill switch triggered",
            });
            halted = true;
          }
        }
      }
    }
    if (a.type === "status") {
      items.push({ id: `status-${items.length}`, kind: "status", activity: a });
      if (a.message.includes("AGENT HALTED")) {
        items.push({
          id: `halt-status-${items.length}`,
          kind: "halt",
          haltReason: a.message,
        });
        halted = true;
      }
    }
    if (a.type === "error") {
      items.push({ id: `err-${items.length}`, kind: "error", activity: a });
    }
    if (a.type === "text") {
      items.push({ id: `text-${items.length}`, kind: "text", activity: a });
    }
    if (a.type === "done") {
      items.push({ id: `done-${items.length}`, kind: "text", activity: a });
    }
  }
  return items;
}

type DeniedProposeWithGuardrails = {
  status: "denied";
  intent_id: string;
  violations: AnyViolation[];
  reasons: string[];
  authoritative: AuthoritativeTerms;
  message: string;
  kill_switch?: { triggered: boolean; reason: string | null };
  risk?: RiskSignals | null;
};

function asDeniedPropose(result: ProposeResult): DeniedProposeWithGuardrails | null {
  if (result.status !== "denied" || !("authoritative" in result)) return null;
  return result as DeniedProposeWithGuardrails;
}

function intentIdFromPropose(result: ProposeResult): string | null {
  if ("intent_id" in result && typeof result.intent_id === "string") return result.intent_id;
  return null;
}

function ProposeOutcomeCard({
  result,
  delegation,
}: {
  result: ProposeResult;
  delegation: DelegationRow | null;
}) {
  const intentId = intentIdFromPropose(result);

  const denied = asDeniedPropose(result);
  if (denied) {
    const auth = denied.authoritative;
    const maxTx = delegation?.max_amount_cents ?? null;
    const allowRecurring = delegation?.allow_recurring ?? false;
    const allowedMerchants = delegation?.allowed_merchants ?? [];
    const merchantAllowed = allowedMerchants.includes(auth.merchant);
    return (
      <div className="space-y-5 rounded-[6px] bg-inverse p-5 text-white shadow-[0_0_0_1px_rgba(229,0,43,0.35)] md:p-6">
        <div className="space-y-3">
          <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-blocked">
            <ShieldBan className="size-4 shrink-0" />
            Action blocked
          </p>
          <p className="font-display text-[32px] font-semibold leading-[0.95] tracking-[-0.045em] sm:text-[40px]">
            Stopped by <span className="text-blocked">AgentLedger</span>.
          </p>
          {denied.kill_switch?.triggered ? (
            <p className="inline-flex items-center gap-2 rounded-[4px] bg-blocked px-2 py-1 text-[11px] font-semibold uppercase tracking-[0.1em] text-white">
              Kill switch triggered · agent suspended
            </p>
          ) : null}
        </div>

        <div className="grid grid-cols-[auto_1fr_1fr] gap-x-4 gap-y-0 overflow-hidden rounded-[4px] border border-white/10 font-mono text-xs sm:text-sm">
          <div className="col-span-3 grid grid-cols-subgrid border-b border-white/10 bg-white/[0.04] px-4 py-2 text-[11px] uppercase tracking-[0.1em] text-white/50">
            <span />
            <span>Requested</span>
            <span>Allowed</span>
          </div>
          <div className="col-span-3 grid grid-cols-subgrid border-b border-white/10 px-4 py-2.5">
            <span className="text-white/50">Amount</span>
            <span className="text-blocked">{formatCents(auth.amount_cents, auth.currency)}</span>
            <span>{maxTx !== null ? formatCents(maxTx) : "—"}</span>
          </div>
          <div className="col-span-3 grid grid-cols-subgrid border-b border-white/10 px-4 py-2.5">
            <span className="text-white/50">Recurring</span>
            <span className={auth.recurring && !allowRecurring ? "text-blocked" : undefined}>
              {String(auth.recurring)}
            </span>
            <span>{String(allowRecurring)}</span>
          </div>
          <div className="col-span-3 grid grid-cols-subgrid px-4 py-2.5">
            <span className="text-white/50">Merchant</span>
            <span className={cn("break-words", !merchantAllowed && "text-blocked")}>
              {auth.merchant_name}
            </span>
            <span>{merchantAllowed ? "true" : "false"}</span>
          </div>
        </div>

        {denied.risk ? <JevSignalBars risk={denied.risk} /> : null}

        {denied.reasons.length > 0 ? (
          <ul className="space-y-1.5 text-sm text-white/80">
            {denied.reasons.map((r) => (
              <li key={r} className="flex gap-2">
                <span className="mt-2 size-1 shrink-0 bg-blocked" aria-hidden />
                <span>{r}</span>
              </li>
            ))}
          </ul>
        ) : null}
        {intentId ? <TimelineLink intentId={intentId} inverse /> : null}
      </div>
    );
  }

  if (result.status === "awaiting_approval") {
    return (
      <div className="space-y-2 rounded-[6px] border border-waiting/30 bg-surface p-4">
        <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-waiting">
          <Clock className="size-4" />
          Awaiting human approval
        </p>
        <p className="text-sm text-ink-2">{result.message}</p>
        {intentId ? <TimelineLink intentId={intentId} /> : null}
      </div>
    );
  }

  if (result.status === "replay") {
    return (
      <div className="space-y-2 rounded-[6px] border border-duplicate/30 bg-duplicate-bg p-4 text-sm">
        <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-duplicate">Replay blocked</p>
        <p className="text-ink-2">{result.message}</p>
        {intentId ? <TimelineLink intentId={intentId} /> : null}
      </div>
    );
  }

  if (result.status === "executed") {
    const auth = result.authoritative;
    const providerLabel = result.provider ? `${result.provider} ${result.provider_reference}` : result.provider_reference;
    return (
      <div className="space-y-3 rounded-[6px] border border-executed/30 bg-executed-bg p-4 md:p-5">
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-executed">
          <CheckCircle2 className="size-4 shrink-0" />
          <span>
            Payment executed · {formatCents(auth.amount_cents, auth.currency)}
            {providerLabel ? ` · ${providerLabel}` : null}
          </span>
        </p>
        <p className="break-all font-mono text-xs text-executed">receipt {result.receipt_id}</p>
        {intentId ? <TimelineLink intentId={intentId} /> : null}
      </div>
    );
  }

  if (result.status === "duplicate") {
    return (
      <div className="space-y-1 rounded-[6px] border border-duplicate/30 bg-duplicate-bg p-4 text-sm">
        <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-duplicate">
          Duplicate execution blocked
        </p>
        <p className="text-ink-2">{result.message}</p>
      </div>
    );
  }

  return null;
}


export interface PlaygroundClientProps {
  userId: string;
  pendingApprovals: PendingApproval[];
  delegation: DelegationRow | null;
  paymentProviderLabel: string;
}

function mergeExecutedPropose(
  base: ProposeResult,
  execution: Extract<ExecuteResult, { status: "executed" }>,
): ProposeResult | null {
  if (!("authoritative" in base)) return null;
  return { ...execution, authoritative: base.authoritative };
}

export function PlaygroundClient({
  userId,
  pendingApprovals,
  delegation,
  paymentProviderLabel,
}: PlaygroundClientProps) {
  const [prompt, setPrompt] = useState(DEFAULT_PROMPT);
  const [compromised, setCompromised] = useState(true);
  const [running, setRunning] = useState(false);
  const [activities, setActivities] = useState<AgentActivity[]>([]);
  const [streamError, setStreamError] = useState<string | null>(null);
  const [proposeOverrides, setProposeOverrides] = useState<Record<string, ProposeResult>>({});
  const abortRef = useRef<AbortController | null>(null);
  const receiptByIntentRef = useRef<Map<string, Record<string, unknown>>>(new Map());
  const baseProposeRef = useRef<Map<string, ProposeResult>>(new Map());

  const feed = buildFeedItems(activities);

  useEffect(() => {
    const m = new Map<string, ProposeResult>();
    for (const item of feed) {
      if (item.kind === "propose" && item.propose) {
        const id = intentIdFromPropose(item.propose);
        if (id) m.set(id, item.propose);
      }
    }
    baseProposeRef.current = m;
  }, [feed]);

  const displayFeed = useMemo(
    () =>
      feed.map((item) => {
        if (item.kind !== "propose" || !item.propose) return item;
        const id = intentIdFromPropose(item.propose);
        if (id && proposeOverrides[id]) {
          return { ...item, propose: proposeOverrides[id] };
        }
        return item;
      }),
    [feed, proposeOverrides],
  );

  const applyExecutedOverride = useCallback(
    (intentId: string, execution: Extract<ExecuteResult, { status: "executed" }>) => {
      setProposeOverrides((prev) => {
        const base = prev[intentId] ?? baseProposeRef.current.get(intentId);
        if (!base) return prev;
        const merged = mergeExecutedPropose(base, execution);
        if (!merged) return prev;
        return { ...prev, [intentId]: merged };
      });
    },
    [],
  );

  const tryApplyFromReceipt = useCallback(
    (intentId: string, receipt: Record<string, unknown>) => {
      const base = baseProposeRef.current.get(intentId);
      if (!base || base.status !== "awaiting_approval") return;
      applyExecutedOverride(intentId, {
        status: "executed",
        intent_id: intentId,
        execution_id: String(receipt.execution_id ?? ""),
        amount: "authoritative" in base ? base.authoritative.amount_cents : 0,
        currency: "authoritative" in base ? base.authoritative.currency : "usd",
        receipt_id: String(receipt.id ?? ""),
        provider: String(receipt.provider ?? "stripe"),
        provider_reference: String(receipt.provider_reference ?? ""),
        stripe_payment_intent_id:
          typeof receipt.stripe_payment_intent_id === "string"
            ? receipt.stripe_payment_intent_id
            : null,
      });
    },
    [applyExecutedOverride],
  );

  const handleApprovalResolved = useCallback(
    (outcome: ApprovalResolveResponse) => {
      if (outcome.execution?.status === "executed") {
        applyExecutedOverride(outcome.intent_id, outcome.execution);
      }
    },
    [applyExecutedOverride],
  );

  useLedgerRealtime(
    userId,
    useCallback(
      (change) => {
        if (change.table === "receipts" && change.operation === "INSERT" && change.record) {
          const intentId =
            typeof change.record.intent_id === "string" ? change.record.intent_id : null;
          if (intentId) {
            receiptByIntentRef.current.set(intentId, change.record);
            tryApplyFromReceipt(intentId, change.record);
          }
        }
        if (change.table === "action_intents" && change.operation === "UPDATE" && change.record) {
          const intentId = typeof change.record.id === "string" ? change.record.id : null;
          if (!intentId || change.record.status !== "executed") return;
          const receipt = receiptByIntentRef.current.get(intentId);
          if (receipt) tryApplyFromReceipt(intentId, receipt);
        }
      },
      [tryApplyFromReceipt],
    ),
  );

  const agentHalted = feed.some((item) => item.kind === "halt");
  const finalText =
    activities.findLast((a) => a.type === "done")?.text ??
    activities.findLast((a) => a.type === "text")?.text ??
    null;

  const runAgent = useCallback(async () => {
    if (running) return;
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setRunning(true);
    setStreamError(null);
    setActivities([]);
    setProposeOverrides({});
    receiptByIntentRef.current.clear();

    try {
      const res = await fetch("/api/agent/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, compromised }),
        signal: ac.signal,
      });

      if (!res.ok) {
        const errBody = (await res.json().catch(() => ({}))) as { message?: string; error?: string };
        setStreamError(errBody.message ?? errBody.error ?? `Agent run failed (${res.status})`);
        return;
      }

      const reader = res.body?.getReader();
      if (!reader) {
        setStreamError("No response stream from agent.");
        return;
      }

      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          try {
            const activity = JSON.parse(trimmed) as AgentActivity;
            setActivities((prev) => [...prev, activity]);
          } catch {
            setStreamError("Malformed stream line from agent.");
          }
        }
      }

      const tail = buffer.trim();
      if (tail) {
        try {
          const activity = JSON.parse(tail) as AgentActivity;
          setActivities((prev) => [...prev, activity]);
        } catch {
          setStreamError("Malformed stream tail from agent.");
        }
      }
    } catch (e) {
      if (e instanceof Error && e.name === "AbortError") return;
      setStreamError("Network error while running agent.");
    } finally {
      setRunning(false);
    }
  }, [compromised, prompt, running]);


  return (
    <div className="space-y-8">
      {delegation ? (
        <div className="space-y-2" title={delegationStrip(delegation)}>
          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-3">
            Active delegation
          </p>
          <ul className="flex flex-wrap gap-2">
            {[
              { k: "max", v: formatCents(delegation.max_amount_cents) },
              { k: "per day", v: formatCents(delegation.daily_limit_cents) },
              { k: "approval above", v: formatCents(delegation.approval_threshold_cents) },
              {
                k: "recurring",
                v: delegation.allow_recurring ? "subscriptions allowed" : "no subscriptions",
              },
              {
                k: "merchants",
                v: String(delegation.allowed_merchants.length),
              },
            ].map((pill) => (
              <li
                key={pill.k}
                className="inline-flex items-center gap-2 rounded-full border border-line bg-surface px-3.5 py-1.5 text-xs"
              >
                <span className="text-ink-3">{pill.k}</span>
                <span className="font-mono text-ink">{pill.v}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="rounded-[6px] border border-waiting/30 bg-waiting-bg px-4 py-3 text-sm text-waiting">
          No active delegation. Configure limits under Delegation before running the agent.
        </p>
      )}

      <section className="space-y-5 rounded-[6px] border border-line bg-surface p-5 md:p-7">
        <div className="space-y-3">
          <Label
            htmlFor="agent-prompt"
            className="text-[11px] font-semibold uppercase tracking-[0.12em] text-accent"
          >
            Task
          </Label>
          <textarea
            id="agent-prompt"
            rows={4}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            disabled={running}
            className="w-full resize-y rounded-[4px] border border-line bg-canvas/40 px-4 py-3 text-[17px] leading-relaxed text-ink placeholder:text-ink-3 focus-visible:border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft disabled:opacity-60"
          />
        </div>

        <div className="flex flex-col gap-5 border-t border-line pt-5 md:flex-row md:items-center md:justify-between">
          <div
            className={cn(
              "flex items-start gap-3 rounded-[4px] border px-3.5 py-3 transition-colors",
              compromised ? "border-blocked/30 bg-blocked-bg" : "border-line bg-surface",
            )}
          >
            <Switch
              id="compromised"
              checked={compromised}
              onCheckedChange={setCompromised}
              disabled={running}
              aria-label="Red-team compromised agent"
            />
            <div className="space-y-0.5">
              <Label
                htmlFor="compromised"
                className={cn(
                  "cursor-pointer text-sm font-semibold",
                  compromised ? "text-blocked" : "text-ink",
                )}
              >
                Red-team: compromised agent
              </Label>
              <p className="max-w-md text-xs leading-relaxed text-ink-2">
                Simulates an agent that obeys prompt-injected merchant content. AgentLedger policy still
                decides.
              </p>
            </div>
          </div>
          <ArrowButton
            type="button"
            variant="primary"
            size="lg"
            onClick={runAgent}
            disabled={running || !prompt.trim()}
          >
            {running ? <Loader2 className="mr-2 inline size-4 animate-spin" /> : null}
            {running ? "Running…" : "Run agent"}
          </ArrowButton>
        </div>
      </section>

      <div className="grid gap-8 lg:grid-cols-[1fr_min(100%,24rem)]">
        <section className="min-h-[320px] space-y-4">
          <div className="flex items-end justify-between gap-4">
            <div className="space-y-1">
              <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-accent">
                Agent activity
              </p>
              <h2 className="font-display text-2xl font-semibold tracking-[-0.03em] text-ink">
                Live tool calls
              </h2>
            </div>
            <span className="font-mono text-xs text-ink-3">NDJSON stream</span>
          </div>

          {streamError ? (
            <p className="rounded-[4px] border border-blocked/30 bg-blocked-bg px-3 py-2 text-sm text-blocked">
              {streamError}
            </p>
          ) : null}

          {feed.length === 0 && !running ? (
            <div className="rounded-[6px] border border-dashed border-line bg-surface px-6 py-14 text-center">
              <p className="text-[15px] text-ink-2">Run the agent to see activity here.</p>
            </div>
          ) : null}

          <ol className="relative space-y-3 before:absolute before:bottom-3 before:left-[31px] before:top-3 before:w-px before:bg-line">
            {displayFeed.map((item) => {
              if (item.kind === "delegation") {
                return (
                  <li key={item.id} className="relative">
                    <StepCard
                      icon={<CheckCircle2 className="size-4" />}
                      label="Read delegated authority"
                      simulated={item.simulated}
                    />
                  </li>
                );
              }
              if (item.kind === "search") {
                const products = item.searchProducts ?? [];
                return (
                  <li key={item.id} className="relative">
                    <StepCard
                      icon={<Sparkles className="size-4" />}
                      tone="accent"
                      label={`Searched marketplace (${item.searchCount ?? 0} products)`}
                      simulated={item.simulated}
                    >
                      {products.length > 0 ? (
                        <ul className="divide-y divide-line rounded-[4px] border border-line text-xs">
                          {products.slice(0, 6).map((p) => {
                            const m = p.merchant;
                            const score =
                              m?.trust_score === null || m?.trust_score === undefined
                                ? null
                                : Number(m.trust_score);
                            return (
                              <li
                                key={p.product_id}
                                className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2"
                              >
                                <span className="font-medium text-ink">{p.name}</span>
                                {m ? (
                                  <>
                                    <span className="font-mono text-ink-2">
                                      trust {score !== null ? score : "—"}
                                    </span>
                                    <span className="rounded-[4px] bg-[#F2F2F2] px-1.5 py-0.5 text-[11px] text-ink-2">
                                      {trustSourceLabel(m.trust_score_source)}
                                    </span>
                                    {m.verified ? (
                                      <span className="rounded-[4px] bg-executed-bg px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-executed">
                                        Verified
                                      </span>
                                    ) : null}
                                  </>
                                ) : null}
                              </li>
                            );
                          })}
                        </ul>
                      ) : null}
                    </StepCard>
                  </li>
                );
              }
              if (item.kind === "halt") {
                return (
                  <li key={item.id} className="relative">
                    <div className="space-y-2 rounded-[6px] bg-blocked px-5 py-5 text-white">
                      <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-white/80">
                        <OctagonAlert className="size-4 shrink-0" />
                        Kill switch
                      </p>
                      <p className="font-display text-[32px] font-semibold leading-[0.95] tracking-[-0.045em]">
                        AGENT HALTED
                      </p>
                      {item.haltReason ? (
                        <p className="font-mono text-xs text-white/85">{item.haltReason}</p>
                      ) : null}
                    </div>
                  </li>
                );
              }
              if (item.kind === "untrusted") {
                return (
                  <li key={item.id} className="relative">
                    <StepCard
                      icon={<AlertTriangle className="size-4" />}
                      tone="waiting"
                      label="Encountered untrusted content"
                    >
                      <p className="line-clamp-3 rounded-[4px] border border-waiting/20 bg-waiting-bg px-3 py-2 font-mono text-xs text-waiting">
                        {item.untrustedExcerpt}
                      </p>
                    </StepCard>
                  </li>
                );
              }
              if (item.kind === "propose" && item.propose) {
                return (
                  <li key={item.id} className="relative">
                    {item.simulated ? (
                      <div className="mb-2 flex justify-end">
                        <SimulatedCompromiseTag />
                      </div>
                    ) : null}
                    <ProposeOutcomeCard result={item.propose} delegation={delegation} />
                  </li>
                );
              }
              if (item.kind === "status" && item.activity?.type === "status") {
                return (
                  <li key={item.id} className="relative pl-12 font-mono text-xs text-ink-3">
                    {item.activity.message}
                  </li>
                );
              }
              if (item.kind === "error" && item.activity?.type === "error") {
                return (
                  <li key={item.id} className="relative">
                    <StepCard icon={<AlertTriangle className="size-4" />} tone="blocked" label="Error">
                      <p className="font-mono text-xs text-blocked">{item.activity.message}</p>
                    </StepCard>
                  </li>
                );
              }
              return null;
            })}
            {running && !agentHalted ? (
              <li className="relative flex items-center gap-3 rounded-[6px] border border-dashed border-line bg-surface px-4 py-3 text-sm text-ink-2">
                <span className="flex size-7 items-center justify-center rounded-[4px] bg-accent-wash text-accent">
                  <Loader2 className="size-4 animate-spin" />
                </span>
                Agent running…
              </li>
            ) : null}
          </ol>

          {finalText ? (
            <div className="rounded-[6px] border border-line bg-surface px-5 py-4">
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-3">
                Agent summary
              </p>
              <p className="text-[15px] leading-relaxed text-ink-2">{finalText}</p>
            </div>
          ) : null}
        </section>

        <aside className="space-y-4">
          <div className="space-y-1">
            <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-accent">Approvals</p>
            <h2 className="font-display text-2xl font-semibold tracking-[-0.03em] text-ink">
              Human in the loop
            </h2>
            <p className="text-sm text-ink-2">Approve or deny when policy requires a human.</p>
          </div>
          <LiveApprovals
            userId={userId}
            initial={pendingApprovals}
            compact
            resolvedHoldMs={10_000}
            onApprovalResolved={handleApprovalResolved}
          />
          <p className="inline-flex items-center gap-2 rounded-full border border-line bg-surface px-3 py-1.5 text-xs text-ink-2">
            <span className="size-1.5 rounded-full bg-executed" aria-hidden />
            Payments · <span className="font-mono text-ink">{paymentProviderLabel}</span>
          </p>
        </aside>
      </div>
    </div>
  );
}

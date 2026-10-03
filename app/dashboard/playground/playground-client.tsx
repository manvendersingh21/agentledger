"use client";

import Link from "next/link";
import { useCallback, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Loader2,
  OctagonAlert,
  Play,
  ShieldBan,
  Sparkles,
} from "lucide-react";
import type { AgentActivity } from "@/lib/agent/types";
import type { DelegationRow, PendingApproval } from "@/lib/data/types";
import type { AnyViolation, AuthoritativeTerms, ProposeResult } from "@/lib/domain/pipeline";
import type { RiskSignals } from "@/lib/domain/guardrail-gate";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { LiveApprovals } from "@/components/approvals/live-approvals";
import { formatCents } from "@/lib/utils";

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
  if (source === "scamadvisor") return "ScamAdvisor";
  return source ?? "unknown";
}

function JevSignalBars({ risk }: { risk: RiskSignals }) {
  const signals = [
    { key: "injection", label: "injection", value: risk.promptInjection },
    { key: "price", label: "price anomaly", value: risk.priceAnomaly },
    { key: "crypto", label: "crypto", value: risk.cryptoExfiltration },
  ] as const;
  return (
    <div className="space-y-2">
      <p className="text-xs font-medium text-red-300/90">
        Jev signals:{" "}
        {signals.map((s, i) => (
          <span key={s.key}>
            {i > 0 ? " · " : null}
            {s.label} {s.value.toFixed(2)}
          </span>
        ))}
      </p>
      <div className="space-y-1.5">
        {signals.map((s) => (
          <div key={s.key} className="flex items-center gap-2 text-xs">
            <span className="w-24 shrink-0 text-muted-foreground">{s.label}</span>
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-red-950/60">
              <div
                className="h-full rounded-full bg-red-400/80"
                style={{ width: `${Math.min(100, Math.max(0, s.value * 100))}%` }}
              />
            </div>
            <span className="w-10 shrink-0 text-right font-mono tabular-nums">{s.value.toFixed(2)}</span>
          </div>
        ))}
      </div>
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
}

function buildFeedItems(activities: AgentActivity[]): FeedItem[] {
  const items: FeedItem[] = [];
  let halted = false;

  for (const a of activities) {
    if (halted) break;

    if (a.type === "tool_result") {
      if (a.tool === "list_delegations") {
        items.push({ id: a.id, kind: "delegation", activity: a });
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
          items.push({ id: a.id, kind: "propose", propose, activity: a });
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
    return (
      <div className="space-y-3 rounded-lg border border-red-500/40 bg-red-500/5 p-4">
        <div className="flex items-center gap-2 text-red-400">
          <ShieldBan className="size-5 shrink-0" />
          <p className="text-sm font-semibold tracking-tight">ACTION BLOCKED by AgentLedger</p>
        </div>
        {denied.risk ? <JevSignalBars risk={denied.risk} /> : null}
        {denied.kill_switch?.triggered ? (
          <p className="text-xs font-medium text-red-300">Kill switch triggered · agent suspended</p>
        ) : null}
        <dl className="grid gap-2 font-mono text-xs sm:text-sm">
          <div className="flex justify-between gap-4 border-b border-red-500/20 pb-2">
            <span className="text-muted-foreground">Requested</span>
            <span>{formatCents(auth.amount_cents, auth.currency)}</span>
          </div>
          <div className="flex justify-between gap-4 border-b border-red-500/20 pb-2">
            <span className="text-muted-foreground">Allowed</span>
            <span>{maxTx !== null ? formatCents(maxTx) : "—"}</span>
          </div>
          <div className="flex justify-between gap-4 border-b border-red-500/20 pb-2">
            <span className="text-muted-foreground">Recurring</span>
            <span>
              {String(auth.recurring)} / Allowed: {String(allowRecurring)}
            </span>
          </div>
          <div className="flex justify-between gap-4">
            <span className="text-muted-foreground">Merchant</span>
            <span className="text-right">
              {auth.merchant_name} / Allowed:{" "}
              {allowedMerchants.includes(auth.merchant) ? "true" : "false"}
            </span>
          </div>
        </dl>
        {denied.reasons.length > 0 ? (
          <ul className="list-disc space-y-1 pl-4 text-xs text-red-300/90">
            {denied.reasons.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        ) : null}
        {intentId ? (
          <Link
            href={`/dashboard/transactions/${intentId}`}
            className="inline-block text-xs text-sky-400 hover:underline"
          >
            Open transaction timeline →
          </Link>
        ) : null}
      </div>
    );
  }

  if (result.status === "awaiting_approval") {
    return (
      <div className="space-y-2 rounded-lg border border-amber-500/40 bg-amber-500/5 p-4">
        <p className="flex items-center gap-2 text-sm font-medium text-amber-400">
          <Clock className="size-4" />
          ◷ awaiting human approval
        </p>
        <p className="text-sm text-muted-foreground">{result.message}</p>
        {intentId ? (
          <Link
            href={`/dashboard/transactions/${intentId}`}
            className="inline-block text-xs text-sky-400 hover:underline"
          >
            Open transaction timeline →
          </Link>
        ) : null}
      </div>
    );
  }

  if (result.status === "replay") {
    return (
      <div className="rounded-lg border border-violet-500/40 bg-violet-500/5 p-4 text-sm text-violet-300">
        <p className="font-medium">Replay blocked</p>
        <p className="mt-1 text-muted-foreground">{result.message}</p>
        {intentId ? (
          <Link
            href={`/dashboard/transactions/${intentId}`}
            className="mt-2 inline-block text-xs text-sky-400 hover:underline"
          >
            Open transaction timeline →
          </Link>
        ) : null}
      </div>
    );
  }

  if (result.status === "executed") {
    const auth = result.authoritative;
    return (
      <div className="space-y-2 rounded-lg border border-emerald-500/40 bg-emerald-500/5 p-4">
        <p className="flex items-center gap-2 text-sm font-medium text-emerald-400">
          <CheckCircle2 className="size-4" />
          Payment executed · {formatCents(auth.amount_cents, auth.currency)}
        </p>
        <p className="font-mono text-xs text-emerald-300/90">
          receipt {result.receipt_id} · {result.provider_reference}
        </p>
        {intentId ? (
          <Link
            href={`/dashboard/transactions/${intentId}`}
            className="inline-block text-xs text-sky-400 hover:underline"
          >
            Open transaction timeline →
          </Link>
        ) : null}
      </div>
    );
  }

  if (result.status === "duplicate") {
    return (
      <div className="rounded-lg border border-violet-500/40 bg-violet-500/5 p-4 text-sm text-violet-300">
        <p className="font-medium">Duplicate execution blocked</p>
        <p className="mt-1 text-muted-foreground">{result.message}</p>
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
  const abortRef = useRef<AbortController | null>(null);

  const feed = buildFeedItems(activities);
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
    <div className="space-y-6">
      {delegation ? (
        <div className="rounded-lg border border-border bg-muted/20 px-4 py-3 font-mono text-xs text-muted-foreground sm:text-sm">
          {delegationStrip(delegation)}
        </div>
      ) : (
        <p className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-sm text-amber-400">
          No active delegation. Configure limits under Delegation before running the agent.
        </p>
      )}

      <div className="space-y-4 rounded-lg border border-border bg-card p-4">
        <div className="space-y-2">
          <Label htmlFor="agent-prompt" className="text-sm font-medium">Task</Label>
          <textarea
            id="agent-prompt"
            rows={4}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            disabled={running}
            className="w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <Switch
              id="compromised"
              checked={compromised}
              onCheckedChange={setCompromised}
              disabled={running}
              aria-label="Red-team compromised agent"
            />
            <div className="space-y-0.5">
              <Label htmlFor="compromised" className="cursor-pointer text-sm font-medium">
                Red-team: compromised agent
              </Label>
              <p className="text-xs text-muted-foreground">
                Simulates an agent that obeys prompt-injected merchant content. AgentLedger policy still
                decides.
              </p>
            </div>
          </div>
          <Button type="button" onClick={runAgent} disabled={running || !prompt.trim()}>
            {running ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />}
            Run agent
          </Button>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_min(100%,22rem)]">
        <Card className="min-h-[320px]">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Agent activity</CardTitle>
            <CardDescription>Live tool calls from the agent run (NDJSON stream).</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {streamError ? (
              <p className="rounded-md border border-red-500/30 bg-red-500/5 px-3 py-2 text-sm text-red-400">
                {streamError}
              </p>
            ) : null}

            {feed.length === 0 && !running ? (
              <p className="text-sm text-muted-foreground">Run the agent to see activity here.</p>
            ) : null}

            <ul className="space-y-2">
              {feed.map((item) => {
                if (item.kind === "delegation") {
                  return (
                    <li
                      key={item.id}
                      className="flex items-center gap-2 rounded-md border border-border bg-muted/10 px-3 py-2 text-sm"
                    >
                      <CheckCircle2 className="size-4 shrink-0 text-emerald-400" />
                      <span>✓ read delegated authority</span>
                    </li>
                  );
                }
                if (item.kind === "search") {
                  const products = item.searchProducts ?? [];
                  return (
                    <li
                      key={item.id}
                      className="space-y-2 rounded-md border border-border bg-muted/10 px-3 py-2 text-sm"
                    >
                      <p className="flex items-center gap-2">
                        <Sparkles className="size-4 shrink-0 text-sky-400" />
                        <span>✓ searched marketplace ({item.searchCount ?? 0} products)</span>
                      </p>
                      {products.length > 0 ? (
                        <ul className="space-y-1.5 border-t border-border/60 pt-2 text-xs">
                          {products.slice(0, 6).map((p) => {
                            const m = p.merchant;
                            const score =
                              m?.trust_score === null || m?.trust_score === undefined
                                ? null
                                : Number(m.trust_score);
                            return (
                              <li key={p.product_id} className="flex flex-wrap items-center gap-x-2 gap-y-1">
                                <span className="font-medium text-foreground/90">{p.name}</span>
                                {m ? (
                                  <>
                                    <span className="font-mono text-muted-foreground">
                                      trust {score !== null ? score : "—"}
                                    </span>
                                    <Badge variant="neutral" className="font-normal normal-case tracking-normal">
                                      {trustSourceLabel(m.trust_score_source)}
                                    </Badge>
                                    {m.verified ? (
                                      <Badge variant="emerald" className="font-normal normal-case tracking-normal">
                                        Verified
                                      </Badge>
                                    ) : null}
                                  </>
                                ) : null}
                              </li>
                            );
                          })}
                        </ul>
                      ) : null}
                    </li>
                  );
                }
                if (item.kind === "halt") {
                  return (
                    <li
                      key={item.id}
                      className="rounded-lg border border-red-500/50 bg-red-600/15 px-4 py-4 text-red-100"
                    >
                      <p className="flex items-center gap-2 text-sm font-semibold text-red-300">
                        <OctagonAlert className="size-5 shrink-0" />
                        AGENT HALTED — kill switch
                      </p>
                      {item.haltReason ? (
                        <p className="mt-2 text-xs text-red-200/90">{item.haltReason}</p>
                      ) : null}
                    </li>
                  );
                }
                if (item.kind === "untrusted") {
                  return (
                    <li
                      key={item.id}
                      className="rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-sm text-amber-400"
                    >
                      <p className="flex items-center gap-2 font-medium">
                        <AlertTriangle className="size-4 shrink-0" />
                        ! encountered untrusted content
                      </p>
                      <p className="mt-1 line-clamp-3 font-mono text-xs text-amber-300/80">
                        {item.untrustedExcerpt}
                      </p>
                    </li>
                  );
                }
                if (item.kind === "propose" && item.propose) {
                  return (
                    <li key={item.id}>
                      <ProposeOutcomeCard result={item.propose} delegation={delegation} />
                    </li>
                  );
                }
                if (item.kind === "status" && item.activity?.type === "status") {
                  return (
                    <li key={item.id} className="text-xs text-muted-foreground">
                      {item.activity.message}
                    </li>
                  );
                }
                if (item.kind === "error" && item.activity?.type === "error") {
                  return (
                    <li
                      key={item.id}
                      className="rounded-md border border-red-500/30 px-3 py-2 text-sm text-red-400"
                    >
                      {item.activity.message}
                    </li>
                  );
                }
                return null;
              })}
              {running && !agentHalted ? (
                <li className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" />
                  Agent running…
                </li>
              ) : null}
            </ul>

            {finalText ? (
              <div className="rounded-md border border-border bg-muted/20 px-3 py-3 text-sm text-muted-foreground">
                {finalText}
              </div>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Approvals</CardTitle>
            <CardDescription>Approve or deny when policy requires a human.</CardDescription>
          </CardHeader>
          <CardContent>
            <LiveApprovals userId={userId} initial={pendingApprovals} compact />
          </CardContent>
          <div className="border-t border-border px-6 py-3">
            <Badge variant="neutral" className="font-normal normal-case tracking-normal">
              Payments · {paymentProviderLabel}
            </Badge>
          </div>
        </Card>
      </div>
    </div>
  );
}

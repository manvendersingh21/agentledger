"use client";

import Link from "next/link";
import { useCallback, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Loader2,
  Play,
  ShieldBan,
  Sparkles,
} from "lucide-react";
import type { AgentActivity } from "@/lib/agent/types";
import type { DelegationRow, PendingApproval } from "@/lib/data/types";
import type { ProposeResult } from "@/lib/domain/pipeline";
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
    merchant?: { slug: string; name: string; trusted: boolean };
    untrusted_merchant_content?: { description: string };
  }>;
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
  kind: "status" | "delegation" | "search" | "untrusted" | "propose" | "text" | "error";
  activity?: AgentActivity;
  propose?: ProposeResult;
  searchCount?: number;
  untrustedExcerpt?: string;
}

function buildFeedItems(activities: AgentActivity[]): FeedItem[] {
  const items: FeedItem[] = [];
  const toolInputs = new Map<string, unknown>();

  for (const a of activities) {
    if (a.type === "tool_call") {
      toolInputs.set(a.id, a.input);
    }
    if (a.type === "tool_result") {
      if (a.tool === "list_delegations") {
        items.push({ id: a.id, kind: "delegation", activity: a });
      }
      if (a.tool === "search_products") {
        const out = a.output as ProductSearchOutput;
        const products = out.products ?? [];
        items.push({ id: a.id, kind: "search", activity: a, searchCount: products.length });
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
        if (propose) items.push({ id: a.id, kind: "propose", propose, activity: a });
      }
    }
    if (a.type === "status") {
      items.push({ id: `status-${items.length}`, kind: "status", activity: a });
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

  if (result.status === "denied") {
    const auth = result.authoritative;
    const maxTx = delegation?.max_amount_cents ?? null;
    const allowRecurring = delegation?.allow_recurring ?? false;
    const allowedMerchants = delegation?.allowed_merchants ?? [];
    return (
      <div className="space-y-3 rounded-lg border border-red-500/40 bg-red-500/5 p-4">
        <div className="flex items-center gap-2 text-red-400">
          <ShieldBan className="size-5 shrink-0" />
          <p className="text-sm font-semibold tracking-tight">ACTION BLOCKED by AgentLedger</p>
        </div>
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
        {result.reasons.length > 0 ? (
          <ul className="list-disc space-y-1 pl-4 text-xs text-red-300/90">
            {result.reasons.map((r) => (
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
                  return (
                    <li
                      key={item.id}
                      className="flex items-center gap-2 rounded-md border border-border bg-muted/10 px-3 py-2 text-sm"
                    >
                      <Sparkles className="size-4 shrink-0 text-sky-400" />
                      <span>✓ searched marketplace ({item.searchCount ?? 0} products)</span>
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
              {running ? (
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

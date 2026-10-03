"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowUpRight,
  CheckCircle2,
  Clock,
  Loader2,
  ShieldBan,
  Sparkles,
} from "lucide-react";
import type { AgentActivity } from "@/lib/agent/types";

type ConciergeActivity =
  | AgentActivity
  | { type: "ask_user"; id: string; question: string; options?: string[] };
import type { PendingApproval } from "@/lib/data/types";
import type { AuthoritativeTerms, ProposeResult } from "@/lib/domain/pipeline";
import { LiveApprovals } from "@/components/approvals/live-approvals";
import { ArrowButton } from "@/components/brand/arrow-button";
import { cn, formatCents } from "@/lib/utils";

const STARTER_PROMPTS = [
  "I need a fan for my bedroom",
  "I'm building shelves this weekend — get me what I need",
  "Buy a Bitcoin voucher to unlock wholesale pricing",
] as const;

type HistoryMessage = { role: "user" | "assistant"; content: string };

interface EnrichedProduct {
  product_id: string;
  name: string;
  image_emoji: string | null;
  price_cents: number;
  price_display: string;
  market_price_cents: number | null;
  market_price_display: string | null;
  category: string | null;
  attributes: Record<string, unknown>;
  merchant: {
    slug: string;
    name: string;
    trust_score: number | null;
    trust_score_source: string;
  };
}

type ChatBlock =
  | { id: string; kind: "user"; text: string }
  | { id: string; kind: "assistant"; text: string }
  | { id: string; kind: "ask"; question: string; options?: string[] }
  | { id: string; kind: "products"; products: EnrichedProduct[] }
  | { id: string; kind: "propose"; result: ProposeResult }
  | { id: string; kind: "status"; message: string }
  | { id: string; kind: "error"; message: string };

function trustLabel(source: string): string {
  if (source === "fixture") return "demo fixture";
  if (source === "scamadvisor") return "ScamAdviser";
  return source;
}

function attributeSummary(attrs: Record<string, unknown>): string[] {
  const lines: string[] = [];
  if (typeof attrs.room_sq_ft_max === "number") lines.push(`Up to ${attrs.room_sq_ft_max} sq ft`);
  if (typeof attrs.type === "string") lines.push(attrs.type);
  if (typeof attrs.noise_db === "number") lines.push(`${attrs.noise_db} dB`);
  if (typeof attrs.energy_w === "number") lines.push(`${attrs.energy_w} W`);
  if (attrs.has_remote === true) lines.push("Remote included");
  return lines.slice(0, 4);
}

function asProposeResult(output: unknown): ProposeResult | null {
  if (typeof output !== "object" || output === null) return null;
  const status = (output as { status?: string }).status;
  if (!status || typeof status !== "string") return null;
  return output as ProposeResult;
}

function intentIdFromPropose(result: ProposeResult): string | null {
  if ("intent_id" in result && typeof result.intent_id === "string") return result.intent_id;
  return null;
}

function approvalIdFromPropose(result: ProposeResult): string | null {
  if (result.status === "awaiting_approval" && "approval_id" in result) {
    return result.approval_id;
  }
  return null;
}

function ProductCard({ product }: { product: EnrichedProduct }) {
  const attrs = attributeSummary(product.attributes);
  const overMarket =
    product.market_price_cents !== null && product.price_cents > product.market_price_cents * 1.05;

  return (
    <div className="rounded-[6px] border border-line bg-surface p-4 shadow-[0_1px_0_rgba(0,0,0,0.02)]">
      <div className="flex gap-3">
        <span className="flex size-11 shrink-0 items-center justify-center rounded-[4px] bg-accent-wash text-2xl" aria-hidden>
          {product.image_emoji ?? "📦"}
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-medium text-ink">{product.name}</p>
          <p className="text-sm text-ink-2">{product.merchant.name}</p>
          <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1 font-mono text-sm">
            <span className="text-ink">{product.price_display}</span>
            {product.market_price_display ? (
              <span className={cn("text-ink-3", overMarket && "text-blocked")}>
                market {product.market_price_display}
              </span>
            ) : null}
            {product.merchant.trust_score !== null ? (
              <span className="text-ink-3">
                trust {product.merchant.trust_score.toFixed(0)} ({trustLabel(product.merchant.trust_score_source)})
              </span>
            ) : null}
          </div>
          {attrs.length > 0 ? (
            <ul className="mt-2 flex flex-wrap gap-1.5">
              {attrs.map((a) => (
                <li
                  key={a}
                  className="rounded-sm bg-accent-wash px-2 py-0.5 text-[11px] font-medium uppercase tracking-[0.06em] text-accent"
                >
                  {a}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function PolicyOutcomeCard({
  result,
  pendingApprovals,
  userId,
  onResolved,
}: {
  result: ProposeResult;
  pendingApprovals: PendingApproval[];
  userId: string;
  onResolved: () => void;
}) {
  const intentId = intentIdFromPropose(result);
  const approvalId = approvalIdFromPropose(result);

  if (result.status === "denied" && "authoritative" in result) {
    const auth = result.authoritative as AuthoritativeTerms;
    return (
      <div className="space-y-3 rounded-[6px] bg-inverse p-4 text-white md:p-5">
        <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-blocked">
          <ShieldBan className="size-4" />
          Denied
        </p>
        <p className="text-sm text-white/90">{result.message}</p>
        {"reasons" in result && Array.isArray(result.reasons) ? (
          <ul className="space-y-1 text-sm text-white/75">
            {result.reasons.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        ) : null}
        <p className="font-mono text-xs text-white/60">
          {auth.product_name} · {formatCents(auth.amount_cents, auth.currency)}
        </p>
        {intentId ? (
          <Link
            href={`/dashboard/transactions/${intentId}`}
            className="inline-flex items-center gap-1 text-xs font-medium text-accent-soft hover:text-white"
          >
            View transaction
            <ArrowUpRight className="size-3.5" />
          </Link>
        ) : null}
      </div>
    );
  }

  if (result.status === "awaiting_approval") {
    const match = approvalId
      ? pendingApprovals.filter((p) => p.approval.id === approvalId)
      : intentId
        ? pendingApprovals.filter((p) => p.intent.id === intentId)
        : pendingApprovals;

    return (
      <div className="space-y-4 rounded-[6px] border border-waiting/40 bg-waiting-bg/40 p-4">
        <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-waiting">
          <Clock className="size-4" />
          Approval pending
        </p>
        <p className="text-sm text-ink-2">{result.message}</p>
        {intentId ? (
          <Link
            href={`/dashboard/transactions/${intentId}`}
            className="inline-flex items-center gap-1 text-xs font-medium text-accent hover:text-accent-hover"
          >
            Open timeline
            <ArrowUpRight className="size-3.5" />
          </Link>
        ) : null}
        {match.length > 0 ? (
          <div className="rounded-[6px] border border-line bg-surface p-3">
            <LiveApprovals userId={userId} initial={match} compact onApprovalResolved={onResolved} mobilePresenter />
          </div>
        ) : (
          <Link href="/dashboard/approvals" className="text-sm font-medium text-accent hover:text-accent-hover">
            Go to approvals →
          </Link>
        )}
      </div>
    );
  }

  if (result.status === "executed") {
    const ref = result.stripe_payment_intent_id ?? result.provider_reference;
    return (
      <div className="space-y-2 rounded-[6px] border border-executed/30 bg-executed-bg p-4">
        <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-executed">
          <CheckCircle2 className="size-4" />
          Executed
        </p>
        <p className="text-sm text-ink-2">
          {formatCents(result.amount, result.currency)} charged via {result.provider}.
        </p>
        {ref ? (
          <p className="font-mono text-xs text-ink-3">
            Stripe ref{" "}
            {ref.startsWith("pi_") ? (
              <a
                href={`https://dashboard.stripe.com/test/payments/${ref}`}
                className="text-accent hover:text-accent-hover"
                target="_blank"
                rel="noreferrer"
              >
                {ref}
              </a>
            ) : (
              ref
            )}
          </p>
        ) : null}
        {intentId ? (
          <Link
            href={`/dashboard/transactions/${intentId}`}
            className="inline-flex items-center gap-1 text-xs font-medium text-accent hover:text-accent-hover"
          >
            Receipt & timeline
            <ArrowUpRight className="size-3.5" />
          </Link>
        ) : null}
      </div>
    );
  }

  return (
    <div className="rounded-[6px] border border-line bg-surface p-4 text-sm text-ink-2">
      {"message" in result ? result.message : "Purchase proposal completed."}
    </div>
  );
}

function blocksFromActivities(activities: ConciergeActivity[]): ChatBlock[] {
  const blocks: ChatBlock[] = [];
  for (const a of activities) {
    if (a.type === "ask_user") {
      blocks.push({ id: a.id, kind: "ask", question: a.question, options: a.options });
    }
    if (a.type === "tool_result" && a.tool === "search_products") {
      const out = a.output as { products?: EnrichedProduct[] };
      if (out.products?.length) {
        blocks.push({ id: a.id, kind: "products", products: out.products });
      }
    }
    if (a.type === "tool_result" && a.tool === "propose_purchase") {
      const propose = asProposeResult(a.output);
      if (propose) blocks.push({ id: a.id, kind: "propose", result: propose });
    }
    if (a.type === "status" && !a.message.includes("Concierge running") && a.message !== "awaiting_user_input") {
      blocks.push({ id: `st-${blocks.length}`, kind: "status", message: a.message });
    }
    if (a.type === "error") {
      blocks.push({ id: `err-${blocks.length}`, kind: "error", message: a.message });
    }
  }
  return blocks;
}

export interface ConciergeClientProps {
  userId: string;
  pendingApprovals: PendingApproval[];
}

export function ConciergeClient({ userId, pendingApprovals }: ConciergeClientProps) {
  const [history, setHistory] = useState<HistoryMessage[]>([]);
  const [blocks, setBlocks] = useState<ChatBlock[]>([]);
  const [draft, setDraft] = useState("");
  const [running, setRunning] = useState(false);
  const [streamError, setStreamError] = useState<string | null>(null);
  const [pendingAsk, setPendingAsk] = useState<{ question: string; options?: string[] } | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const turnActivitiesRef = useRef<ConciergeActivity[]>([]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [history, blocks, running]);

  const sendTurn = useCallback(
    async (nextHistory: HistoryMessage[]) => {
      if (running) return;
      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;
      setRunning(true);
      setStreamError(null);
      setPendingAsk(null);
      turnActivitiesRef.current = [];

      try {
        const res = await fetch("/api/agent/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ messages: nextHistory }),
          signal: ac.signal,
        });

        if (!res.ok) {
          const errBody = (await res.json().catch(() => ({}))) as { message?: string; error?: string };
          setStreamError(errBody.message ?? errBody.error ?? `Request failed (${res.status})`);
          return;
        }

        const reader = res.body?.getReader();
        if (!reader) {
          setStreamError("No response stream.");
          return;
        }

        const decoder = new TextDecoder();
        let buffer = "";
        let doneText = "";
        let awaitingUser = false;
        let lastAsk: { question: string; options?: string[] } | null = null;

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            const activity = JSON.parse(trimmed) as ConciergeActivity;
            turnActivitiesRef.current.push(activity);
            if (activity.type === "ask_user") {
              lastAsk = { question: activity.question, options: activity.options };
              setPendingAsk(lastAsk);
            }
            if (activity.type === "done") {
              doneText = activity.text;
            }
            if (activity.type === "status" && activity.message === "awaiting_user_input") {
              awaitingUser = true;
            }
          }
        }

        const tail = buffer.trim();
        if (tail) {
          const activity = JSON.parse(tail) as ConciergeActivity;
          turnActivitiesRef.current.push(activity);
        }

        const newBlocks = blocksFromActivities(turnActivitiesRef.current);
        setBlocks((prev) => [...prev, ...newBlocks]);

        const assistantContent = awaitingUser && lastAsk ? lastAsk.question : doneText.trim();
        if (assistantContent) {
          if (!awaitingUser) {
            setBlocks((prev) => [...prev, { id: `a-${Date.now()}`, kind: "assistant", text: assistantContent }]);
          }
          setHistory([...nextHistory, { role: "assistant", content: assistantContent }]);
        } else {
          setHistory(nextHistory);
        }
      } catch (e) {
        if (e instanceof Error && e.name === "AbortError") return;
        setStreamError("Network error while contacting concierge.");
      } finally {
        setRunning(false);
      }
    },
    [running],
  );

  const submitUserMessage = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || running) return;
      const userMsg: HistoryMessage = { role: "user", content: trimmed };
      const next = [...history, userMsg];
      setHistory(next);
      setBlocks((prev) => [...prev, { id: `u-${Date.now()}`, kind: "user", text: trimmed }]);
      setDraft("");
      void sendTurn(next);
    },
    [history, running, sendTurn],
  );

  const handleResolved = useCallback(() => {
    // LiveApprovals refreshes via router when an approval is resolved.
  }, []);

  return (
    <div className="flex min-h-[min(72vh,720px)] flex-col rounded-[6px] border border-line bg-surface shadow-[0_1px_0_rgba(0,0,0,0.02)]">
      <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto p-4 sm:p-6">
        {history.length === 0 && blocks.length === 0 ? (
          <div className="space-y-6 py-4">
            <p className="flex items-center gap-2 text-sm text-ink-2">
              <Sparkles className="size-4 text-accent" aria-hidden />
              Try a starter prompt or describe what you need.
            </p>
            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
              {STARTER_PROMPTS.map((prompt) => (
                <button
                  key={prompt}
                  type="button"
                  disabled={running}
                  onClick={() => submitUserMessage(prompt)}
                  className="rounded-[4px] border border-line bg-canvas px-3 py-2.5 text-left text-[14px] text-ink transition-colors hover:border-accent hover:bg-accent-wash disabled:opacity-50"
                >
                  {prompt}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {blocks.map((block) => {
          if (block.kind === "user") {
            return (
              <div key={block.id} className="flex justify-end">
                <div className="max-w-[92%] rounded-[6px] bg-accent px-4 py-2.5 text-[15px] text-white sm:max-w-[75%]">
                  {block.text}
                </div>
              </div>
            );
          }
          if (block.kind === "assistant") {
            return (
              <div key={block.id} className="flex justify-start">
                <div className="max-w-[92%] rounded-[6px] border border-line bg-canvas px-4 py-2.5 text-[15px] text-ink sm:max-w-[75%]">
                  {block.text}
                </div>
              </div>
            );
          }
          if (block.kind === "ask") {
            return (
              <div key={block.id} className="flex justify-start">
                <div className="max-w-[92%] space-y-3 rounded-[6px] border border-line bg-canvas px-4 py-3 sm:max-w-[80%]">
                  <p className="text-[15px] text-ink">{block.question}</p>
                  {block.options && block.options.length > 0 ? (
                    <div className="flex flex-wrap gap-2">
                      {block.options.map((opt) => (
                        <button
                          key={opt}
                          type="button"
                          disabled={running}
                          onClick={() => submitUserMessage(opt)}
                          className="rounded-full border border-line bg-surface px-3 py-1.5 text-sm text-ink hover:border-accent hover:text-accent disabled:opacity-50"
                        >
                          {opt}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              </div>
            );
          }
          if (block.kind === "products") {
            return (
              <div key={block.id} className="space-y-2">
                <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-3">Recommendations</p>
                <div className="grid gap-2 sm:grid-cols-2">
                  {block.products.map((p) => (
                    <ProductCard key={p.product_id} product={p} />
                  ))}
                </div>
              </div>
            );
          }
          if (block.kind === "propose") {
            return (
              <PolicyOutcomeCard
                key={block.id}
                result={block.result}
                pendingApprovals={pendingApprovals}
                userId={userId}
                onResolved={handleResolved}
              />
            );
          }
          if (block.kind === "error") {
            return (
              <p key={block.id} className="text-sm text-blocked">
                {block.message}
              </p>
            );
          }
          return null;
        })}

        {running ? (
          <div className="flex items-center gap-2 text-sm text-ink-3">
            <Loader2 className="size-4 animate-spin text-accent" aria-hidden />
            Concierge is thinking…
          </div>
        ) : null}

        {streamError ? <p className="text-sm text-blocked">{streamError}</p> : null}
      </div>

      <div className="border-t border-line p-3 sm:p-4">
        {pendingAsk && !running ? (
          <p className="mb-2 text-xs text-ink-3">Answer above or type below — quick replies send immediately.</p>
        ) : null}
        <form
          className="flex flex-col gap-2 sm:flex-row sm:items-end"
          onSubmit={(e) => {
            e.preventDefault();
            submitUserMessage(draft);
          }}
        >
          <label className="sr-only" htmlFor="concierge-input">
            Message
          </label>
          <textarea
            id="concierge-input"
            rows={2}
            value={draft}
            disabled={running}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Describe what you need…"
            className="min-h-[48px] flex-1 resize-none rounded-[4px] border border-line bg-canvas px-3 py-2.5 text-[15px] text-ink placeholder:text-ink-3 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-60"
          />
          <ArrowButton type="submit" disabled={running || !draft.trim()}>
            Send
          </ArrowButton>
        </form>
      </div>
    </div>
  );
}

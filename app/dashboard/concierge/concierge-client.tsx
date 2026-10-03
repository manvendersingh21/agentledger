"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowUpRight,
  CheckCircle2,
  Clock,
  Globe,
  Loader2,
  ShieldBan,
  Sparkles,
} from "lucide-react";
import type { AgentActivity } from "@/lib/agent/types";

type ConciergeActivity =
  | AgentActivity
  | { type: "ask_user"; id: string; question: string; options?: string[] };
import type { PendingApproval } from "@/lib/data/types";
import type { ExternalPurchaseContext } from "@/lib/domain/external";
import type { AuthoritativeTerms, ProposeResult } from "@/lib/domain/pipeline";
import type { RecipePlan } from "@/lib/domain/recipes";
import { LiveApprovals } from "@/components/approvals/live-approvals";
import { ArrowButton } from "@/components/brand/arrow-button";
import { PlaybookPicker } from "@/components/concierge/playbook-picker";
import { RecipeChecklist } from "@/components/concierge/recipe-checklist";
import { useLedgerRealtime, type LedgerChange } from "@/lib/realtime/use-ledger-realtime";
import { cn, formatCents } from "@/lib/utils";

/** Server-side CONCIERGE_CHAT_BODY accepts at most 30 history messages. */
const MAX_HISTORY_MESSAGES = 30;

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
  | { id: string; kind: "recipe"; plan: RecipePlan }
  | { id: string; kind: "propose"; result: ProposeResult; external?: ExternalPurchaseContext }
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

function externalContextFromOutput(output: unknown): ExternalPurchaseContext | undefined {
  if (typeof output !== "object" || output === null) return undefined;
  const ext = (output as { external?: ExternalPurchaseContext }).external;
  return ext && typeof ext === "object" ? ext : undefined;
}

function recipePlanFromOutput(output: unknown): RecipePlan | null {
  if (typeof output !== "object" || output === null) return null;
  const out = output as { known?: boolean } & Partial<RecipePlan>;
  if (out.known !== true) return null;
  if (typeof out.dish !== "string" || !Array.isArray(out.ingredients) || !Array.isArray(out.missing)) return null;
  return { dish: out.dish, servings: Number(out.servings ?? 1), ingredients: out.ingredients, missing: out.missing };
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

/** External (unverified website) purchase: the price is agent-claimed, never from a verified catalog. */
function ExternalPurchaseBanner({ external }: { external: ExternalPurchaseContext }) {
  return (
    <div className="rounded-[6px] border border-waiting/40 bg-waiting-bg/40 p-3">
      <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-waiting">
        <Globe className="size-4" aria-hidden />
        {external.price_label}
      </p>
      <p className="mt-1.5 text-sm text-ink-2">
        External website <span className="font-mono text-ink">{external.domain}</span> is not verified by AgentLedger
        (trust score <span className="font-mono">{external.trust.score ?? "unknown"}</span>,{" "}
        {external.trust.source}). {external.note}
      </p>
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

// `prefix` must be unique per turn: activity ids (and the counters below) restart every
// turn on the server, so without it blocks from different turns collide on React keys.
function blocksFromActivities(activities: ConciergeActivity[], prefix: string): ChatBlock[] {
  const blocks: ChatBlock[] = [];
  for (const a of activities) {
    if (a.type === "ask_user") {
      blocks.push({ id: `${prefix}-${a.id}`, kind: "ask", question: a.question, options: a.options });
    }
    if (a.type === "tool_result" && a.tool === "search_products") {
      const out = a.output as { products?: EnrichedProduct[] };
      if (out.products?.length) {
        blocks.push({ id: `${prefix}-${a.id}`, kind: "products", products: out.products });
      }
    }
    if (a.type === "tool_result" && a.tool === "plan_recipe") {
      const plan = recipePlanFromOutput(a.output);
      if (plan) blocks.push({ id: `${prefix}-${a.id}`, kind: "recipe", plan });
    }
    if (a.type === "tool_result" && (a.tool === "propose_purchase" || a.tool === "propose_external_purchase")) {
      const propose = asProposeResult(a.output);
      if (propose) {
        blocks.push({
          id: `${prefix}-${a.id}`,
          kind: "propose",
          result: propose,
          external: a.tool === "propose_external_purchase" ? externalContextFromOutput(a.output) : undefined,
        });
      }
    }
    if (a.type === "status" && !a.message.includes("Concierge running") && a.message !== "awaiting_user_input") {
      blocks.push({ id: `${prefix}-st-${blocks.length}`, kind: "status", message: a.message });
    }
    if (a.type === "error") {
      blocks.push({ id: `${prefix}-err-${blocks.length}`, kind: "error", message: a.message });
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
  const router = useRouter();
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const turnActivitiesRef = useRef<ConciergeActivity[]>([]);
  // Synchronous mirror of `running`: the state value in closures is stale within the same
  // tick, so rapid double-submits (Enter + click) would otherwise start two streams.
  const runningRef = useRef(false);
  const turnSeqRef = useRef(0);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [history, blocks, running]);

  // Abort any in-flight stream on unmount.
  useEffect(() => () => abortRef.current?.abort(), []);

  // Keep server-provided props (pendingApprovals) fresh: a propose_purchase made during this
  // chat creates the approval after the page rendered, so without a refresh the inline
  // approval card never appears.
  const onLedgerChange = useCallback(
    (change: LedgerChange) => {
      if (change.table === "approvals" || change.table === "action_intents" || change.table === "receipts") {
        router.refresh();
      }
    },
    [router],
  );
  useLedgerRealtime(userId, onLedgerChange);

  const sendTurn = useCallback(async (nextHistory: HistoryMessage[]) => {
    if (runningRef.current) return;
    runningRef.current = true;
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    const turnPrefix = `t${++turnSeqRef.current}`;
    setRunning(true);
    setStreamError(null);
    setPendingAsk(null);
    turnActivitiesRef.current = [];

    const turn = {
      doneText: "",
      awaitingUser: false,
      lastAsk: null as { question: string; options?: string[] } | null,
      blocksFlushed: false,
    };

    const trackLine = (line: string) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      let activity: ConciergeActivity;
      try {
        activity = JSON.parse(trimmed) as ConciergeActivity;
      } catch {
        return; // skip a malformed/truncated NDJSON line instead of dropping the whole turn
      }
      turnActivitiesRef.current.push(activity);
      if (activity.type === "ask_user") {
        turn.lastAsk = { question: activity.question, options: activity.options };
        setPendingAsk(turn.lastAsk);
      }
      if (activity.type === "done") {
        turn.doneText = activity.text;
      }
      if (activity.type === "status" && activity.message === "awaiting_user_input") {
        turn.awaitingUser = true;
      }
    };

    const flushBlocks = () => {
      if (turn.blocksFlushed) return;
      turn.blocksFlushed = true;
      const newBlocks = blocksFromActivities(turnActivitiesRef.current, turnPrefix);
      if (newBlocks.length > 0) setBlocks((prev) => [...prev, ...newBlocks]);
    };

    try {
      const res = await fetch("/api/agent/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: nextHistory.slice(-MAX_HISTORY_MESSAGES) }),
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
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) trackLine(line);
      }
      buffer += decoder.decode(); // flush a multi-byte character split across chunks
      trackLine(buffer);

      flushBlocks();

      const assistantContent = turn.awaitingUser && turn.lastAsk ? turn.lastAsk.question : turn.doneText.trim();
      if (assistantContent) {
        if (!turn.awaitingUser) {
          setBlocks((prev) => [...prev, { id: `${turnPrefix}-a`, kind: "assistant", text: assistantContent }]);
        }
        setHistory([...nextHistory, { role: "assistant", content: assistantContent }]);
      } else {
        setHistory(nextHistory);
      }
    } catch (e) {
      if (e instanceof Error && e.name === "AbortError") return;
      flushBlocks(); // keep whatever streamed before the failure visible
      setStreamError("Network error while contacting concierge.");
    } finally {
      // Only clear the running flag if this turn is still the current one; a superseding
      // turn owns the flag now and must not be unlocked by the aborted turn's cleanup.
      if (abortRef.current === ac) {
        runningRef.current = false;
        setRunning(false);
      }
    }
  }, []);

  const submitUserMessage = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || runningRef.current) return;
      const userMsg: HistoryMessage = { role: "user", content: trimmed };
      const next = [...history, userMsg];
      setHistory(next);
      setBlocks((prev) => [...prev, { id: `u-${Date.now()}`, kind: "user", text: trimmed }]);
      setDraft("");
      void sendTurn(next);
    },
    [history, sendTurn],
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
              Pick a playbook or describe what you need.
            </p>
            <PlaybookPicker disabled={running} onPick={submitUserMessage} />
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
          if (block.kind === "recipe") {
            return (
              <RecipeChecklist
                key={block.id}
                plan={block.plan}
                buying={running}
                onBuyMissing={
                  block.plan.missing.length > 0
                    ? () => submitUserMessage("Buy the missing ingredients from the recipe plan")
                    : undefined
                }
              />
            );
          }
          if (block.kind === "propose") {
            return (
              <div key={block.id} className="space-y-2">
                {block.external ? <ExternalPurchaseBanner external={block.external} /> : null}
                <PolicyOutcomeCard
                  result={block.result}
                  pendingApprovals={pendingApprovals}
                  userId={userId}
                  onResolved={handleResolved}
                />
              </div>
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
            maxLength={8000}
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

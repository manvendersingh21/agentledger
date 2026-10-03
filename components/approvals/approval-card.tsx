"use client";

import { useEffect, useState } from "react";
import { Check, CheckCircle2, ExternalLink, Loader2, X } from "lucide-react";
import type { PendingApproval } from "@/lib/data/types";
import type { ExecuteResult } from "@/lib/domain/pipeline";
import { Button } from "@/components/ui/button";
import { ArrowButton } from "@/components/brand/arrow-button";
import { cn, formatCents } from "@/lib/utils";

interface ApprovalResolveResponse {
  resolved: boolean;
  approval_status: string;
  intent_id: string;
  intent_status: string;
  execution?: ExecuteResult;
}

export type { ApprovalResolveResponse };

interface ChecklistItem {
  ok: boolean;
  emphasis?: boolean;
  text: string;
}

function stripeTestPaymentUrl(providerReference: string | null | undefined): string | null {
  const ref = providerReference?.trim();
  if (!ref?.startsWith("pi_")) return null;
  return `https://dashboard.stripe.com/test/payments/${ref}`;
}

function paymentIntentIdFromExecution(execution: ExecuteResult | undefined): string | null {
  if (!execution || execution.status !== "executed") return null;
  const fromField = execution.stripe_payment_intent_id;
  if (fromField?.startsWith("pi_")) return fromField;
  if (execution.provider_reference.startsWith("pi_")) return execution.provider_reference;
  return null;
}

function buildPolicyChecklist(item: PendingApproval): ChecklistItem[] {
  const rules = item.decision?.rules_evaluated ?? {};
  const d = item.delegation;
  const items: ChecklistItem[] = [];

  const tx = rules.transaction_limit as { passed?: boolean } | undefined;
  if (d && tx) {
    items.push({
      ok: Boolean(tx.passed),
      text: tx.passed
        ? `Below ${formatCents(d.max_amount_cents)} transaction limit`
        : `Exceeds ${formatCents(d.max_amount_cents)} transaction limit`,
    });
  }

  const daily = rules.daily_limit as { passed?: boolean } | undefined;
  if (daily) {
    items.push({
      ok: Boolean(daily.passed),
      text: daily.passed ? "Daily limit remains valid" : "Daily limit would be exceeded",
    });
  }

  const recurring = rules.recurring as { passed?: boolean; requested?: boolean } | undefined;
  if (recurring) {
    const oneTime = recurring.requested === false;
    items.push({
      ok: Boolean(recurring.passed),
      text: oneTime ? "One-time purchase" : "Recurring purchase",
    });
  }

  const merchant = rules.merchant as { passed?: boolean } | undefined;
  if (merchant) {
    items.push({
      ok: Boolean(merchant.passed),
      text: merchant.passed ? "Allowed merchant" : "Merchant not allowed",
    });
  }

  const threshold = rules.approval_threshold as { requires_approval?: boolean } | undefined;
  if (threshold?.requires_approval && d) {
    items.push({
      ok: false,
      emphasis: true,
      text: `Human approval required above ${formatCents(d.approval_threshold_cents)}`,
    });
  }

  return items;
}

export interface ApprovalCardProps {
  item: PendingApproval;
  onResolved?: (outcome: ApprovalResolveResponse) => void;
  /** Sticky thumb-sized action bar on small screens (first pending card on approvals page). */
  stickyMobileActions?: boolean;
}

export function ApprovalCard({ item, onResolved, stickyMobileActions }: ApprovalCardProps) {
  const { approval, intent, agentName } = item;
  const [mounted, setMounted] = useState(false);
  const [loading, setLoading] = useState<"approved" | "denied" | null>(null);
  const [outcome, setOutcome] = useState<ApprovalResolveResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const t = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(t);
  }, []);

  const productName = intent.payload.product_name ?? "purchase";
  const merchantName = intent.payload.merchant_name ?? intent.merchant_slug;
  const checklist = buildPolicyChecklist(item);
  const resolved = outcome !== null || approval.status !== "pending";

  const executed = outcome?.execution?.status === "executed" ? outcome.execution : null;
  const stripePiId = paymentIntentIdFromExecution(outcome?.execution);
  const stripeUrl = stripeTestPaymentUrl(stripePiId);
  const approved = outcome?.approval_status === "approved";

  async function submit(decision: "approved" | "denied") {
    if (loading || resolved) return;
    setLoading(decision);
    setError(null);
    try {
      const res = await fetch(`/api/approvals/${approval.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision }),
      });
      const body = (await res.json()) as ApprovalResolveResponse & { message?: string; error?: string };
      if (!res.ok) {
        setError(body.message ?? body.error ?? "Could not resolve approval.");
        return;
      }
      setOutcome(body);
      onResolved?.(body);
    } catch {
      setError("Network error. Try again.");
    } finally {
      setLoading(null);
    }
  }

  const actionBar = !resolved ? (
    <div
      className={cn(
        "flex gap-3",
        stickyMobileActions
          ? "fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/95 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur-sm md:static md:z-auto md:border-t-0 md:bg-transparent md:p-0 md:backdrop-blur-none"
          : "pt-1",
      )}
    >
      <Button
        type="button"
        variant="outline"
        className={cn(
          "min-h-14 flex-1 rounded-[4px] border-line bg-surface text-base font-semibold text-ink hover:bg-canvas md:h-12 md:min-h-0 md:flex-none md:px-5 md:text-sm md:font-medium",
        )}
        disabled={loading !== null}
        onClick={() => submit("denied")}
      >
        {loading === "denied" ? <Loader2 className="size-5 animate-spin" /> : null}
        Deny
      </Button>
      <Button
        type="button"
        className={cn(
          "min-h-14 flex-[1.2] rounded-[4px] bg-accent text-base font-semibold text-white hover:bg-accent-hover md:hidden",
        )}
        disabled={loading !== null}
        onClick={() => submit("approved")}
      >
        {loading === "approved" ? <Loader2 className="size-5 animate-spin" /> : null}
        Approve
      </Button>
      <ArrowButton
        type="button"
        variant="primary"
        size="lg"
        className="hidden min-h-14 md:inline-flex"
        disabled={loading !== null}
        onClick={() => submit("approved")}
      >
        {loading === "approved" ? (
          <Loader2 className="mr-2 inline size-4 animate-spin" />
        ) : null}
        Approve {formatCents(intent.amount_cents, intent.currency)}
      </ArrowButton>
    </div>
  ) : null;

  return (
    <article
      className={cn(
        "w-full max-w-full overflow-hidden rounded-[6px] border bg-surface transition-all duration-300 ease-out",
        executed || approved ? "border-executed/40" : "border-line",
        mounted ? "translate-y-0 opacity-100" : "translate-y-1 opacity-0",
        stickyMobileActions && !resolved ? "pb-[calc(5.5rem+env(safe-area-inset-bottom))] md:pb-0" : null,
      )}
    >
      <div className="space-y-5 p-4 sm:p-5 md:p-6">
        <header className="space-y-3">
          <p
            className={cn(
              "flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.12em]",
              executed || approved
                ? "text-executed"
                : outcome?.approval_status === "denied"
                  ? "text-ink-2"
                  : "text-waiting",
            )}
          >
            <span
              className={cn(
                "inline-block size-1.5 rounded-full",
                executed || approved
                  ? "bg-executed"
                  : outcome?.approval_status === "denied"
                    ? "bg-ink-3"
                    : "animate-pulse bg-waiting",
              )}
              aria-hidden
            />
            {executed
              ? "Executed"
              : approved
                ? "Approved"
                : outcome?.approval_status === "denied"
                  ? "Denied"
                  : "Waiting for you"}
          </p>
          <p className="text-[15px] leading-snug text-ink-2">
            <span className="font-medium text-ink">{agentName}</span> wants to spend
          </p>
          <p
            className="font-display text-[clamp(2.75rem,12vw,3.5rem)] font-semibold leading-[0.95] tracking-[-0.045em] text-ink tabular-nums sm:text-[56px]"
          >
            {formatCents(intent.amount_cents, intent.currency)}
          </p>
        </header>

        <dl className="grid grid-cols-1 gap-x-6 gap-y-3 border-t border-line pt-4 text-sm sm:grid-cols-2">
          <div className="min-w-0 space-y-0.5">
            <dt className="text-[11px] uppercase tracking-[0.08em] text-ink-3">Requested action</dt>
            <dd className="font-medium text-ink">Purchase {productName}</dd>
          </div>
          <div className="min-w-0 space-y-0.5">
            <dt className="text-[11px] uppercase tracking-[0.08em] text-ink-3">Merchant</dt>
            <dd className="break-words text-ink">{merchantName}</dd>
          </div>
          <div className="space-y-0.5">
            <dt className="text-[11px] uppercase tracking-[0.08em] text-ink-3">Amount</dt>
            <dd className="font-mono text-ink">{formatCents(intent.amount_cents, intent.currency)}</dd>
          </div>
          <div className="space-y-0.5">
            <dt className="text-[11px] uppercase tracking-[0.08em] text-ink-3">Type</dt>
            <dd className="text-ink">{intent.recurring ? "Recurring" : "One-time purchase"}</dd>
          </div>
        </dl>

        {checklist.length > 0 ? (
          <ul className="divide-y divide-line rounded-[6px] border border-line text-sm">
            {checklist.map((line) => (
              <li
                key={line.text}
                className={cn(
                  "flex items-start gap-3 px-3.5 py-2.5",
                  line.emphasis
                    ? "bg-waiting-bg font-medium text-waiting"
                    : line.ok
                      ? "text-ink-2"
                      : "bg-blocked-bg text-blocked",
                )}
              >
                {line.emphasis ? (
                  <span
                    className="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-[3px] bg-waiting text-[11px] font-bold text-white"
                    aria-hidden
                  >
                    !
                  </span>
                ) : line.ok ? (
                  <span
                    className="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-[3px] bg-executed-bg text-executed"
                    aria-hidden
                  >
                    <Check className="size-3" />
                  </span>
                ) : (
                  <span
                    className="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-[3px] bg-blocked text-white"
                    aria-hidden
                  >
                    <X className="size-3" />
                  </span>
                )}
                <span>{line.text}</span>
              </li>
            ))}
          </ul>
        ) : null}

        {error ? (
          <p className="rounded-[4px] border border-blocked/30 bg-blocked-bg px-3 py-2 text-sm text-blocked">
            {error}
          </p>
        ) : null}

        {outcome && outcome.approval_status === "denied" ? (
          <p className="rounded-[4px] border border-line bg-canvas px-3 py-2.5 text-sm text-ink-2">
            You denied this action. The intent will not execute.
          </p>
        ) : null}

        {approved ? (
          <div
            className="space-y-4 rounded-[6px] border border-executed/35 bg-executed-bg px-4 py-6 text-center sm:px-6 sm:py-8"
            role="status"
          >
            <CheckCircle2 className="mx-auto size-12 text-executed sm:size-14" aria-hidden />
            <div className="space-y-1">
              <p className="font-display text-[clamp(2rem,10vw,2.75rem)] font-semibold leading-[0.95] tracking-[-0.04em] text-executed tabular-nums">
                {formatCents(intent.amount_cents, intent.currency)}
              </p>
              <p className="text-[17px] font-medium text-ink">{merchantName}</p>
              <p className="text-sm text-ink-2">
                {executed ? "Payment executed and recorded in the audit chain." : "Approved — executing payment…"}
              </p>
            </div>
            {stripeUrl ? (
              <ArrowButton
                href={stripeUrl}
                external
                variant="primary"
                size="lg"
                className="mx-auto w-full max-w-sm justify-center sm:w-auto"
                icon={<ExternalLink className="size-4" aria-hidden />}
              >
                View in Stripe
              </ArrowButton>
            ) : null}
            {executed ? (
              <dl className="mx-auto max-w-md space-y-2 border-t border-executed/20 pt-4 text-left font-mono text-xs text-executed">
                <div className="flex flex-wrap justify-between gap-2">
                  <dt className="opacity-70">receipt</dt>
                  <dd className="break-all text-right">{executed.receipt_id}</dd>
                </div>
                <div className="flex flex-wrap justify-between gap-2">
                  <dt className="opacity-70">provider ref</dt>
                  <dd className="break-all text-right">{executed.provider_reference}</dd>
                </div>
              </dl>
            ) : null}
          </div>
        ) : null}

        {actionBar && !stickyMobileActions ? actionBar : null}
      </div>
      {actionBar && stickyMobileActions ? actionBar : null}
    </article>
  );
}

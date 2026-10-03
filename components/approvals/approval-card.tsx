"use client";

import { useEffect, useState } from "react";
import { Check, Loader2, X } from "lucide-react";
import type { PendingApproval } from "@/lib/data/types";
import type { ExecuteResult } from "@/lib/domain/pipeline";
import { Button } from "@/components/ui/button";
import { cn, formatCents } from "@/lib/utils";

interface ApprovalResolveResponse {
  resolved: boolean;
  approval_status: string;
  intent_id: string;
  intent_status: string;
  execution?: ExecuteResult;
}

interface ChecklistItem {
  ok: boolean;
  emphasis?: boolean;
  text: string;
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
  onResolved?: () => void;
}

export function ApprovalCard({ item, onResolved }: ApprovalCardProps) {
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
      onResolved?.();
    } catch {
      setError("Network error. Try again.");
    } finally {
      setLoading(null);
    }
  }

  const executed = outcome?.execution?.status === "executed" ? outcome.execution : null;

  return (
    <article
      className={cn(
        "rounded-lg border border-amber-500/40 bg-card shadow-sm transition-all duration-300 ease-out",
        mounted ? "translate-y-0 opacity-100" : "translate-y-1 opacity-0",
      )}
    >
      <div className="space-y-4 p-4 md:p-5">
        <header className="space-y-1">
          <p className="text-sm font-medium leading-snug">
            <span className="text-foreground">{agentName}</span>
            <span className="text-muted-foreground"> wants to spend </span>
            <span className="font-mono text-foreground">{formatCents(intent.amount_cents, intent.currency)}</span>
          </p>
        </header>

        <dl className="grid gap-2 text-sm">
          <div className="flex flex-wrap gap-x-2">
            <dt className="text-muted-foreground">Requested action</dt>
            <dd className="font-medium">Purchase {productName}</dd>
          </div>
          <div className="flex flex-wrap gap-x-2">
            <dt className="text-muted-foreground">Merchant</dt>
            <dd>{merchantName}</dd>
          </div>
          <div className="flex flex-wrap gap-x-2">
            <dt className="text-muted-foreground">Amount</dt>
            <dd className="font-mono">{formatCents(intent.amount_cents, intent.currency)}</dd>
          </div>
          <div className="flex flex-wrap gap-x-2">
            <dt className="text-muted-foreground">Type</dt>
            <dd>{intent.recurring ? "Recurring" : "One-time purchase"}</dd>
          </div>
        </dl>

        {checklist.length > 0 ? (
          <ul className="space-y-1.5 rounded-md border border-border bg-muted/20 px-3 py-2.5 text-sm">
            {checklist.map((line) => (
              <li
                key={line.text}
                className={cn(
                  "flex items-start gap-2",
                  line.emphasis ? "text-amber-400" : line.ok ? "text-muted-foreground" : "text-red-400",
                )}
              >
                {line.emphasis ? (
                  <span className="mt-0.5 shrink-0 font-medium">!</span>
                ) : line.ok ? (
                  <Check className="mt-0.5 size-3.5 shrink-0 text-emerald-400" aria-hidden />
                ) : (
                  <X className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                )}
                <span>{line.emphasis ? line.text : line.ok ? `✓ ${line.text}` : line.text}</span>
              </li>
            ))}
          </ul>
        ) : null}

        {error ? (
          <p className="rounded-md border border-red-500/30 bg-red-500/5 px-3 py-2 text-sm text-red-400">{error}</p>
        ) : null}

        {outcome && outcome.approval_status === "denied" ? (
          <p className="rounded-md border border-border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
            You denied this action. The intent will not execute.
          </p>
        ) : null}

        {executed ? (
          <p className="rounded-md border border-emerald-500/30 bg-emerald-500/5 px-3 py-2 text-sm text-emerald-400">
            Payment executed · receipt{" "}
            <span className="font-mono text-emerald-300">{executed.receipt_id}</span>
            {" · "}
            <span className="font-mono">{executed.provider_reference}</span>
          </p>
        ) : null}

        {!resolved ? (
          <div className="flex flex-wrap gap-2 pt-1">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={loading !== null}
              onClick={() => submit("denied")}
            >
              {loading === "denied" ? <Loader2 className="size-4 animate-spin" /> : null}
              Deny
            </Button>
            <Button
              type="button"
              variant="success"
              size="sm"
              disabled={loading !== null}
              onClick={() => submit("approved")}
            >
              {loading === "approved" ? <Loader2 className="size-4 animate-spin" /> : null}
              Approve {formatCents(intent.amount_cents, intent.currency)}
            </Button>
          </div>
        ) : null}
      </div>
    </article>
  );
}

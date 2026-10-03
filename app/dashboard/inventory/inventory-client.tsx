"use client";

import { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { LiveApprovals } from "@/components/approvals/live-approvals";
import { ArrowButton } from "@/components/brand/arrow-button";
import type { PendingApproval } from "@/lib/data/types";
import type { InventoryItemRow, RestockLineResult } from "@/lib/domain/inventory";
import { useLedgerRealtime, type LedgerChange } from "@/lib/realtime/use-ledger-realtime";
import { cn, formatCents } from "@/lib/utils";

export interface InventoryClientProps {
  userId: string;
  initialItems: InventoryItemRow[];
  approvalThresholdCents: number;
  maxAmountCents: number;
  scenario: string;
  autopilotPending: PendingApproval[];
}

function stockPct(item: InventoryItemRow): number {
  const par = Number(item.par_level);
  if (par <= 0) return 0;
  return Math.min(100, Math.round((Number(item.on_hand) / par) * 100));
}

function isLow(item: InventoryItemRow): boolean {
  return Number(item.on_hand) <= Number(item.reorder_point);
}

function outcomeStyles(outcome: RestockLineResult["outcome"]): string {
  switch (outcome) {
    case "auto_bought":
      return "bg-executed-bg text-executed";
    case "waiting":
      return "bg-waiting-bg text-waiting";
    case "blocked":
      return "bg-blocked-bg text-blocked";
    default:
      return "bg-[#F2F2F2] text-ink-2";
  }
}

function outcomeLabel(outcome: RestockLineResult["outcome"]): string {
  switch (outcome) {
    case "auto_bought":
      return "Auto-bought";
    case "waiting":
      return "Waiting for you";
    case "blocked":
      return "Blocked";
    case "skipped":
      return "Skipped";
    default:
      return outcome;
  }
}

function shouldRefresh(change: LedgerChange): boolean {
  const table = change.table as string;
  if (table === "inventory_items") return true;
  return change.table === "approvals" || change.table === "action_intents" || change.table === "receipts";
}

export function InventoryClient({
  userId,
  initialItems,
  approvalThresholdCents,
  maxAmountCents,
  scenario,
  autopilotPending,
}: InventoryClientProps) {
  const router = useRouter();
  const [results, setResults] = useState<RestockLineResult[]>([]);
  const [busy, setBusy] = useState<"simulate" | "restock" | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Synchronous guard: `busy` state is stale within the same tick, so a rapid double-click
  // would fire two simulate/restock requests before React re-renders the disabled buttons.
  const busyRef = useRef(false);

  const onRealtime = useCallback(
    (change: LedgerChange) => {
      if (!shouldRefresh(change)) return;
      if (change.table === "receipts") {
        // An inline-approved autopilot purchase executed: GET /api/inventory reconciles the
        // receipt into on_hand before we re-render, otherwise the table shows stale stock.
        void fetch("/api/inventory").catch(() => undefined).finally(() => router.refresh());
        return;
      }
      router.refresh();
    },
    [router],
  );

  useLedgerRealtime(userId, onRealtime);

  async function runSimulate() {
    if (busyRef.current) return;
    busyRef.current = true;
    setError(null);
    setBusy("simulate");
    try {
      const res = await fetch("/api/inventory/simulate", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      const json = (await res.json().catch(() => ({}))) as { message?: string };
      if (!res.ok) throw new Error(json.message ?? "Simulate failed");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Simulate failed");
    } finally {
      busyRef.current = false;
      setBusy(null);
    }
  }

  async function runAutopilot() {
    if (busyRef.current) return;
    busyRef.current = true;
    setError(null);
    setBusy("restock");
    try {
      const res = await fetch("/api/inventory/restock", { method: "POST" });
      const json = (await res.json().catch(() => ({}))) as { results?: RestockLineResult[]; message?: string };
      if (!res.ok) throw new Error(json.message ?? "Restock failed");
      if (json.results) setResults(json.results);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Restock failed");
    } finally {
      busyRef.current = false;
      setBusy(null);
    }
  }

  const autoUnder = formatCents(approvalThresholdCents);
  const needsYouAbove = formatCents(approvalThresholdCents + 1);

  return (
    <div className="space-y-10">
      <section className="rounded-[6px] border border-line bg-surface p-5 sm:p-6">
        <h2 className="font-display text-lg font-semibold tracking-[-0.03em] text-ink">Autopilot mode</h2>
        <p className="mt-2 max-w-3xl text-[15px] leading-relaxed text-ink-2">
          Scenario <span className="font-mono text-ink">{scenario}</span> — purchases up to{" "}
          <span className="font-mono text-ink">{formatCents(maxAmountCents)}</span> per transaction. Under{" "}
          <span className="font-mono text-accent">{autoUnder}</span> auto-approve and charge; from{" "}
          <span className="font-mono text-waiting">{needsYouAbove}</span> you approve inline below.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <ArrowButton
            type="button"
            variant="secondary"
            disabled={busy !== null}
            onClick={() => void runSimulate()}
          >
            {busy === "simulate" ? "Simulating…" : "Simulate busy night"}
          </ArrowButton>
          <ArrowButton type="button" disabled={busy !== null} onClick={() => void runAutopilot()}>
            {busy === "restock" ? "Running autopilot…" : "Run autopilot"}
          </ArrowButton>
        </div>
        {error ? <p className="mt-3 text-sm text-blocked">{error}</p> : null}
      </section>

      <section className="space-y-4">
        <h2 className="font-display text-xl font-semibold tracking-[-0.03em] text-ink sm:text-2xl">Stock on hand</h2>
        <div className="overflow-x-auto rounded-[6px] border border-line bg-surface">
          <table className="w-full min-w-[640px] text-left text-[15px]">
            <thead>
              <tr className="border-b border-line bg-canvas text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-3">
                <th className="px-5 py-3">Item</th>
                <th className="px-5 py-3">On hand</th>
                <th className="px-5 py-3">Par</th>
                <th className="px-5 py-3 w-[40%]">Level</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {initialItems.map((item) => {
                const low = isLow(item);
                const pct = stockPct(item);
                return (
                  <tr key={item.id} className="hover:bg-accent-wash/30">
                    <td className="px-5 py-4 font-medium text-ink">
                      {item.name}
                      {low ? (
                        <span className="ml-2 inline-flex rounded-[4px] bg-blocked-bg px-2 py-0.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-blocked">
                          Low
                        </span>
                      ) : null}
                    </td>
                    <td className="px-5 py-4 font-mono text-ink-2">
                      {item.on_hand} {item.unit}
                    </td>
                    <td className="px-5 py-4 font-mono text-ink-3">
                      {item.par_level} {item.unit}
                    </td>
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-3">
                        <div className="h-2 flex-1 overflow-hidden rounded-full bg-canvas">
                          <div
                            className={cn("h-full rounded-full transition-all", low ? "bg-blocked" : "bg-accent")}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                        <span className="w-10 font-mono text-xs text-ink-3">{pct}%</span>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {results.length > 0 ? (
        <section className="space-y-4">
          <h2 className="font-display text-xl font-semibold tracking-[-0.03em] text-ink sm:text-2xl">
            Latest autopilot run
          </h2>
          <ul className="divide-y divide-line rounded-[6px] border border-line bg-surface">
            {results.map((line) => (
              <li key={`${line.inventory_item_id}-${line.intent_id ?? line.message}`} className="space-y-3 px-5 py-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 space-y-1">
                    <p className="font-medium text-ink">{line.item_name}</p>
                    {line.product_name ? (
                      <p className="font-mono text-xs text-ink-3">{line.product_name}</p>
                    ) : null}
                    <p className="text-sm text-ink-2">{line.message}</p>
                    {line.provider_reference ? (
                      <p className="font-mono text-xs text-executed">Stripe ref: {line.provider_reference}</p>
                    ) : null}
                  </div>
                  <span
                    className={cn(
                      "inline-flex shrink-0 rounded-[4px] px-2 py-1 text-[11px] font-semibold uppercase tracking-[0.08em]",
                      outcomeStyles(line.outcome),
                    )}
                  >
                    {outcomeLabel(line.outcome)}
                  </span>
                </div>
                {line.outcome === "waiting" && line.approval_id ? (
                  <div className="rounded-[4px] border border-line bg-canvas p-3">
                    <LiveApprovals
                      userId={userId}
                      initial={autopilotPending.filter((p) => p.approval.id === line.approval_id)}
                      compact
                      resolvedHoldMs={2000}
                    />
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {autopilotPending.length > 0 ? (
        <section className="space-y-4">
          <h2 className="font-display text-xl font-semibold tracking-[-0.03em] text-ink sm:text-2xl">
            Autopilot approvals
          </h2>
          <LiveApprovals userId={userId} initial={autopilotPending} compact resolvedHoldMs={3000} />
        </section>
      ) : null}
    </div>
  );
}

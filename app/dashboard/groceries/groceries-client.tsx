"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { LiveApprovals } from "@/components/approvals/live-approvals";
import { ArrowButton } from "@/components/brand/arrow-button";
import type { PendingApproval } from "@/lib/data/types";
import type {
  GroceryCheckoutLineResult,
  GroceryListRow,
  GroceryPlan,
} from "@/lib/domain/groceries";
import { useLedgerRealtime, type LedgerChange } from "@/lib/realtime/use-ledger-realtime";
import { cn, formatCents } from "@/lib/utils";

export interface GroceriesClientProps {
  userId: string;
  initialItems: GroceryListRow[];
  initialWeeklyBudgetCents: number;
  approvalThresholdCents: number;
  groceryPending: PendingApproval[];
}

function outcomeStyle(outcome: GroceryCheckoutLineResult["outcome"]): string {
  if (outcome === "auto_bought") return "bg-executed-bg text-executed";
  if (outcome === "waiting") return "bg-waiting-bg text-waiting";
  return "bg-blocked-bg text-blocked";
}

function outcomeLabel(outcome: GroceryCheckoutLineResult["outcome"]): string {
  if (outcome === "auto_bought") return "AUTO-BOUGHT";
  if (outcome === "waiting") return "WAITING FOR YOU";
  return "BLOCKED";
}

function shouldRefresh(change: LedgerChange): boolean {
  return ["grocery_lists", "grocery_settings", "approvals", "action_intents", "receipts"].includes(
    change.table as string,
  );
}

export function GroceriesClient({
  userId,
  initialItems,
  initialWeeklyBudgetCents,
  approvalThresholdCents,
  groceryPending,
}: GroceriesClientProps) {
  const router = useRouter();
  const [itemName, setItemName] = useState("");
  const [itemUnit, setItemUnit] = useState("item");
  const [itemQuantity, setItemQuantity] = useState("1");
  const [itemStaple, setItemStaple] = useState(false);
  const [frequencyDays, setFrequencyDays] = useState("7");
  const [budgetDollars, setBudgetDollars] = useState((initialWeeklyBudgetCents / 100).toFixed(2));
  const [plan, setPlan] = useState<GroceryPlan | null>(null);
  const [results, setResults] = useState<GroceryCheckoutLineResult[]>([]);
  const [busy, setBusy] = useState<"add" | "budget" | "plan" | "checkout" | "delete" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const onRealtime = useCallback(
    (change: LedgerChange) => {
      if (shouldRefresh(change)) router.refresh();
    },
    [router],
  );
  useLedgerRealtime(userId, onRealtime);

  async function responseMessage(response: Response): Promise<string> {
    const json = (await response.json()) as { message?: string };
    return json.message ?? `Request failed (${response.status})`;
  }

  async function addItem(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setBusy("add");
    try {
      const response = await fetch("/api/groceries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          item_name: itemName,
          quantity: Number(itemQuantity),
          unit: itemUnit,
          staple: itemStaple,
          frequency_days: Number(frequencyDays),
        }),
      });
      if (!response.ok) throw new Error(await responseMessage(response));
      setItemName("");
      setItemUnit("item");
      setItemQuantity("1");
      setItemStaple(false);
      setPlan(null);
      setResults([]);
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not add grocery item.");
    } finally {
      setBusy(null);
    }
  }

  async function saveBudget() {
    setError(null);
    setBusy("budget");
    try {
      const cents = Math.round(Number(budgetDollars) * 100);
      const response = await fetch("/api/groceries", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "settings", weekly_budget_cents: cents }),
      });
      if (!response.ok) throw new Error(await responseMessage(response));
      setPlan(null);
      setResults([]);
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not update weekly budget.");
    } finally {
      setBusy(null);
    }
  }

  async function removeItem(id: string) {
    setError(null);
    setBusy("delete");
    try {
      const response = await fetch(`/api/groceries?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      if (!response.ok) throw new Error(await responseMessage(response));
      setPlan(null);
      setResults([]);
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not remove grocery item.");
    } finally {
      setBusy(null);
    }
  }

  async function planBasket() {
    setError(null);
    setBusy("plan");
    try {
      const response = await fetch("/api/groceries/plan", { method: "POST" });
      const json = (await response.json()) as GroceryPlan & { message?: string };
      if (!response.ok) throw new Error(json.message ?? "Could not plan basket.");
      setPlan(json);
      setResults([]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not plan basket.");
    } finally {
      setBusy(null);
    }
  }

  async function checkout() {
    if (!plan || plan.basket.length === 0) return;
    setError(null);
    setBusy("checkout");
    try {
      const response = await fetch("/api/groceries/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lines: plan.basket.map((line) => ({
            grocery_list_id: line.grocery_list_id,
            product_id: line.product_id,
            quantity: line.quantity,
          })),
        }),
      });
      const json = (await response.json()) as { results?: GroceryCheckoutLineResult[]; message?: string };
      if (!response.ok) throw new Error(json.message ?? "Checkout failed.");
      setResults(json.results ?? []);
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Checkout failed.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-10">
      <section className="grid gap-4 lg:grid-cols-[1fr_280px]">
        <div className="rounded-[6px] border border-line bg-surface p-5 sm:p-6">
          <h2 className="font-display text-xl font-semibold tracking-[-0.03em] text-ink">Your grocery rhythm</h2>
          <p className="mt-2 text-sm leading-relaxed text-ink-2">
            Staples become due when their frequency elapses. One-off items stay due until they are bought.
          </p>
          <form onSubmit={(event) => void addItem(event)} className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <label className="sm:col-span-2 lg:col-span-2">
              <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-3">Add item</span>
              <input
                required
                value={itemName}
                onChange={(event) => setItemName(event.target.value)}
                placeholder="e.g. Pasta"
                className="mt-1 h-11 w-full rounded-[4px] border border-line bg-white px-3 text-sm text-ink outline-none focus:border-accent"
              />
            </label>
            <label>
              <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-3">Qty</span>
              <input
                type="number"
                min={1}
                max={50}
                required
                value={itemQuantity}
                onChange={(event) => setItemQuantity(event.target.value)}
                className="mt-1 h-11 w-full rounded-[4px] border border-line bg-white px-3 font-mono text-sm text-ink outline-none focus:border-accent"
              />
            </label>
            <label>
              <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-3">Unit</span>
              <input
                required
                value={itemUnit}
                onChange={(event) => setItemUnit(event.target.value)}
                className="mt-1 h-11 w-full rounded-[4px] border border-line bg-white px-3 text-sm text-ink outline-none focus:border-accent"
              />
            </label>
            <div className="flex items-end">
              <button
                type="submit"
                disabled={busy !== null}
                className="h-11 w-full rounded-[4px] bg-accent px-4 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-50"
              >
                {busy === "add" ? "Adding…" : "Add item"}
              </button>
            </div>
            <label className="flex items-center gap-2 text-sm text-ink-2 sm:col-span-1">
              <input
                type="checkbox"
                checked={itemStaple}
                onChange={(event) => setItemStaple(event.target.checked)}
                className="size-4 accent-accent"
              />
              Repeat staple
            </label>
            <label className="flex items-center gap-2 sm:col-span-1">
              <span className="text-xs text-ink-3">Every</span>
              <input
                type="number"
                min={1}
                max={365}
                value={frequencyDays}
                onChange={(event) => setFrequencyDays(event.target.value)}
                disabled={!itemStaple}
                className="h-9 w-16 rounded-[4px] border border-line bg-white px-2 font-mono text-sm text-ink disabled:bg-canvas"
              />
              <span className="text-xs text-ink-3">days</span>
            </label>
          </form>
        </div>

        <div className="rounded-[6px] border border-line bg-inverse p-5 text-white sm:p-6">
          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-accent-soft">Weekly budget</p>
          <label className="mt-4 flex items-center border-b border-white/30 pb-2">
            <span className="font-mono text-xl text-white/70">$</span>
            <input
              type="number"
              min={1}
              max={1000}
              step="0.01"
              value={budgetDollars}
              onChange={(event) => setBudgetDollars(event.target.value)}
              className="min-w-0 flex-1 bg-transparent px-2 font-mono text-2xl text-white outline-none"
            />
          </label>
          <button
            type="button"
            onClick={() => void saveBudget()}
            disabled={busy !== null}
            className="mt-5 h-10 w-full rounded-[4px] bg-white text-sm font-medium text-ink hover:bg-accent-wash disabled:opacity-50"
          >
            {busy === "budget" ? "Saving…" : "Save budget"}
          </button>
          <p className="mt-3 text-xs leading-relaxed text-white/60">
            Lines above {formatCents(approvalThresholdCents)} pause for your approval.
          </p>
        </div>
      </section>

      {error ? (
        <p className="rounded-[4px] border border-blocked/20 bg-blocked-bg px-4 py-3 text-sm text-blocked">{error}</p>
      ) : null}

      <section className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="font-display text-xl font-semibold tracking-[-0.03em] text-ink sm:text-2xl">Your list</h2>
            <p className="mt-1 text-sm text-ink-2">{initialItems.length} items tracked</p>
          </div>
          <ArrowButton type="button" disabled={busy !== null} onClick={() => void planBasket()}>
            {busy === "plan" ? "Planning…" : "Plan my basket"}
          </ArrowButton>
        </div>
        <div className="overflow-x-auto rounded-[6px] border border-line bg-surface">
          <table className="w-full min-w-[650px] text-left text-sm">
            <thead>
              <tr className="border-b border-line bg-canvas text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-3">
                <th className="px-5 py-3">Item</th>
                <th className="px-5 py-3">Quantity</th>
                <th className="px-5 py-3">Schedule</th>
                <th className="px-5 py-3">Last bought</th>
                <th className="px-5 py-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {initialItems.map((item) => (
                <tr key={item.id} className="hover:bg-accent-wash/30">
                  <td className="px-5 py-4 font-medium text-ink">{item.item_name}</td>
                  <td className="px-5 py-4 font-mono text-ink-2">
                    {item.quantity} {item.unit}
                  </td>
                  <td className="px-5 py-4">
                    {item.staple ? (
                      <span className="rounded-[4px] bg-accent-wash px-2 py-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-accent">
                        Every {item.frequency_days} days
                      </span>
                    ) : (
                      <span className="text-ink-3">One-off</span>
                    )}
                  </td>
                  <td className="px-5 py-4 text-ink-3">
                    {item.last_bought_at ? new Date(item.last_bought_at).toLocaleDateString() : "Not yet"}
                  </td>
                  <td className="px-5 py-4 text-right">
                    <button
                      type="button"
                      onClick={() => void removeItem(item.id)}
                      disabled={busy !== null}
                      className="text-xs font-medium text-ink-3 hover:text-blocked disabled:opacity-50"
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {plan ? (
        <section className="space-y-4">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <h2 className="font-display text-xl font-semibold tracking-[-0.03em] text-ink sm:text-2xl">
                Planned basket
              </h2>
              <p className="mt-1 max-w-2xl text-sm text-ink-2">{plan.explanation}</p>
            </div>
            <div className="text-right">
              <p className="font-mono text-2xl font-semibold text-ink">{formatCents(plan.basket_total_cents)}</p>
              <p className="text-xs text-ink-3">
                {formatCents(plan.weekly_spent_cents)} already committed of {formatCents(plan.weekly_budget_cents)}
              </p>
            </div>
          </div>

          <div className="overflow-x-auto rounded-[6px] border border-line bg-surface">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead>
                <tr className="border-b border-line bg-canvas text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-3">
                  <th className="px-5 py-3">Item</th>
                  <th className="px-5 py-3">Store</th>
                  <th className="px-5 py-3">Price vs market</th>
                  <th className="px-5 py-3">Savings</th>
                  <th className="px-5 py-3">Safety note</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {plan.basket.map((line) => (
                  <tr key={line.grocery_list_id}>
                    <td className="px-5 py-4">
                      <p className="font-medium text-ink">{line.item_name}</p>
                      <p className="mt-0.5 text-xs text-ink-3">
                        {line.quantity} × {line.product_name}
                      </p>
                    </td>
                    <td className="px-5 py-4 text-ink-2">{line.merchant_name}</td>
                    <td className="px-5 py-4 font-mono text-ink">
                      {formatCents(line.unit_price_cents)}
                      <span className="ml-2 text-xs text-ink-3">
                        / market {line.market_price_cents === null ? "—" : formatCents(line.market_price_cents)}
                      </span>
                    </td>
                    <td className="px-5 py-4 font-mono text-executed">{formatCents(line.savings_cents)}</td>
                    <td className="max-w-[260px] px-5 py-4 text-xs leading-relaxed text-ink-2">
                      {line.skipped_cheaper_untrusted ? (
                        <span className="text-waiting">
                          Skipped sketchy cheaper option from {line.skipped_cheaper_untrusted.merchant_name} (
                          {formatCents(line.skipped_cheaper_untrusted.price_cents)}).
                        </span>
                      ) : (
                        "Cheapest trusted allowed option."
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {plan.dropped.length > 0 ? (
            <div className="rounded-[6px] border border-line bg-canvas p-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-3">Not in this basket</p>
              <ul className="mt-2 space-y-1 text-sm text-ink-2">
                {plan.dropped.map((item) => (
                  <li key={item.grocery_list_id}>
                    <span className="font-medium text-ink">{item.item_name}:</span> {item.reason}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="flex justify-end">
            <ArrowButton
              type="button"
              disabled={busy !== null || plan.basket.length === 0}
              onClick={() => void checkout()}
            >
              {busy === "checkout" ? "Checking out…" : "Checkout with AgentLedger"}
            </ArrowButton>
          </div>
        </section>
      ) : null}

      {results.length > 0 ? (
        <section className="space-y-4">
          <h2 className="font-display text-xl font-semibold tracking-[-0.03em] text-ink sm:text-2xl">
            Checkout outcomes
          </h2>
          <ul className="divide-y divide-line rounded-[6px] border border-line bg-surface">
            {results.map((result) => (
              <li key={`${result.grocery_list_id}-${result.intent_id ?? result.outcome}`} className="space-y-3 p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-medium text-ink">
                      {result.item_name} <span className="font-normal text-ink-3">· {result.merchant_name}</span>
                    </p>
                    <p className="mt-1 max-w-3xl text-sm leading-relaxed text-ink-2">{result.message}</p>
                    {result.provider_reference ? (
                      <p className="mt-1 font-mono text-xs text-executed">{result.provider_reference}</p>
                    ) : null}
                  </div>
                  <span
                    className={cn(
                      "rounded-[4px] px-2 py-1 text-[11px] font-semibold uppercase tracking-[0.08em]",
                      outcomeStyle(result.outcome),
                    )}
                  >
                    {outcomeLabel(result.outcome)}
                  </span>
                </div>
                {result.outcome === "waiting" && result.approval_id ? (
                  <div className="rounded-[4px] border border-line bg-canvas p-3">
                    <LiveApprovals
                      userId={userId}
                      initial={groceryPending.filter((entry) => entry.approval.id === result.approval_id)}
                      compact
                      resolvedHoldMs={2500}
                    />
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {groceryPending.length > 0 ? (
        <section className="space-y-4">
          <h2 className="font-display text-xl font-semibold tracking-[-0.03em] text-ink sm:text-2xl">
            Grocery approvals
          </h2>
          <LiveApprovals userId={userId} initial={groceryPending} compact resolvedHoldMs={3000} />
        </section>
      ) : null}
    </div>
  );
}

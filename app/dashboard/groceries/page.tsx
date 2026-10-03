import { Eyebrow } from "@/components/brand/eyebrow";
import { getPendingApprovals } from "@/lib/data/queries";
import { listGroceries, reconcileGroceryPurchases } from "@/lib/domain/groceries";
import { getDelegation } from "@/lib/domain/pipeline";
import { getDomainContext } from "@/lib/domain/server-context";
import { GroceriesClient } from "./groceries-client";

export const dynamic = "force-dynamic";

export default async function GroceriesPage() {
  const session = await getDomainContext("groceries-page");
  if (!session) throw new Error("not signed in");
  await reconcileGroceryPurchases(session.ctx);
  const [delegation, pending, groceries] = await Promise.all([
    getDelegation(session.ctx),
    getPendingApprovals(),
    listGroceries(session.ctx),
  ]);
  const groceryPending = pending.filter((entry) => entry.intent.payload?.channel === "grocery");

  return (
    <div className="w-full max-w-full space-y-8 overflow-x-hidden sm:space-y-12">
      <header className="space-y-3 sm:space-y-4">
        <Eyebrow>Everyday autopilot</Eyebrow>
        <h1 className="font-display text-[32px] font-semibold leading-[0.95] tracking-[-0.045em] text-ink sm:text-[44px] md:text-[56px]">
          Groceries, on <span className="text-accent">autopilot.</span>
        </h1>
        <p className="max-w-2xl text-[15px] leading-relaxed text-ink-2">
          Keep staples on schedule, stay inside a weekly budget, and let AgentLedger buy routine items while
          expensive lines wait for you.
        </p>
      </header>

      <GroceriesClient
        userId={session.principal.id}
        initialItems={groceries.items}
        initialWeeklyBudgetCents={groceries.settings.weekly_budget_cents}
        approvalThresholdCents={delegation?.approvalThresholdCents ?? 4000}
        groceryPending={groceryPending}
      />
    </div>
  );
}

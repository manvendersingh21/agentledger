import { ensureSetup, getDelegation, getPendingApprovals } from "@/lib/data/queries";
import { createClient } from "@/lib/supabase/server";
import { Eyebrow } from "@/components/brand/eyebrow";
import { InventoryClient } from "./inventory-client";
import type { InventoryItemRow } from "@/lib/domain/inventory";

export const dynamic = "force-dynamic";

export default async function InventoryPage() {
  const { principal } = await ensureSetup();
  const db = await createClient();
  const [delegation, pending, inventoryRes] = await Promise.all([
    getDelegation(),
    getPendingApprovals(),
    db.from("inventory_items").select("*").order("name"),
  ]);

  const items = (inventoryRes.data ?? []) as InventoryItemRow[];
  const autopilotPending = pending.filter(
    (p) => p.intent.payload?.channel === "autopilot" || p.intent.reason?.startsWith("Autopilot restock"),
  );

  return (
    <div className="w-full max-w-full space-y-8 overflow-x-hidden sm:space-y-12">
      <header className="space-y-3 sm:space-y-4">
        <Eyebrow>Restaurant</Eyebrow>
        <h1 className="font-display text-[32px] font-semibold leading-[0.95] tracking-[-0.045em] text-ink sm:text-[44px] md:text-[56px]">
          Inventory <span className="text-accent">autopilot</span>
        </h1>
        <p className="max-w-2xl text-[15px] leading-relaxed text-ink-2">
          Stock levels, deterministic restock proposals, and policy-gated purchasing. Routine orders under your
          approval threshold auto-execute; larger buys wait for you on the record.
        </p>
      </header>

      <InventoryClient
        userId={principal.id}
        initialItems={items}
        approvalThresholdCents={delegation?.approval_threshold_cents ?? 7500}
        maxAmountCents={delegation?.max_amount_cents ?? 12000}
        scenario={delegation?.scenario ?? "restaurant"}
        autopilotPending={autopilotPending}
      />
    </div>
  );
}

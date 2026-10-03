import { NextResponse } from "next/server";
import { getDomainContext } from "@/lib/domain/server-context";
import { errorResponse, unauthorized } from "@/lib/domain/http";
import { getDelegation } from "@/lib/domain/pipeline";
import { listInventory, reconcileAutopilotReceipts } from "@/lib/domain/inventory";

export async function GET() {
  try {
    const session = await getDomainContext("inventory");
    if (!session) return unauthorized();
    await reconcileAutopilotReceipts(session.ctx);
    const [items, delegation] = await Promise.all([listInventory(session.ctx), getDelegation(session.ctx)]);
    let scenario: string | null = null;
    if (delegation) {
      const { data: row } = await session.ctx.db
        .from("delegations")
        .select("scenario")
        .eq("id", delegation.id)
        .maybeSingle();
      scenario = typeof row?.scenario === "string" ? row.scenario : null;
    }
    return NextResponse.json({
      items,
      delegation: delegation
        ? {
            approval_threshold_cents: delegation.approvalThresholdCents,
            max_amount_cents: delegation.maxAmountCents,
            scenario,
          }
        : null,
    });
  } catch (error) {
    return errorResponse(error);
  }
}

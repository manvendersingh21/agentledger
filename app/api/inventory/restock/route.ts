import { NextResponse } from "next/server";
import { getDomainContext } from "@/lib/domain/server-context";
import { errorResponse, unauthorized } from "@/lib/domain/http";
import {
  applyReceiptToInventory,
  listInventory,
  reconcileAutopilotReceipts,
  runRestock,
} from "@/lib/domain/inventory";

export async function POST() {
  try {
    const session = await getDomainContext("inventory-restock");
    if (!session) return unauthorized();
    const { results, items } = await runRestock(session.ctx);
    for (const line of results) {
      if (line.outcome === "auto_bought" && line.intent_id) {
        await applyReceiptToInventory(session.ctx, line.intent_id);
      }
    }
    await reconcileAutopilotReceipts(session.ctx);
    const refreshed = await listInventory(session.ctx);
    return NextResponse.json({ results, items: refreshed.length > 0 ? refreshed : items });
  } catch (error) {
    return errorResponse(error);
  }
}

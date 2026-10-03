import { NextResponse } from "next/server";
import { z } from "zod";
import { listGroceries, reconcileGroceryPurchases } from "@/lib/domain/groceries";
import { errorResponse, unauthorized } from "@/lib/domain/http";
import { getDomainContext } from "@/lib/domain/server-context";

const AddItem = z.object({
  item_name: z.string().trim().min(1).max(100),
  quantity: z.number().int().min(1).max(50).default(1),
  unit: z.string().trim().min(1).max(30).default("item"),
  staple: z.boolean().default(false),
  frequency_days: z.number().int().min(1).max(365).default(7),
});

const UpdateSettings = z.object({
  kind: z.literal("settings"),
  weekly_budget_cents: z.number().int().min(100).max(100_000),
});

const UpdateItem = z.object({
  kind: z.literal("item"),
  id: z.string().uuid(),
  quantity: z.number().int().min(1).max(50).optional(),
  unit: z.string().trim().min(1).max(30).optional(),
  staple: z.boolean().optional(),
  frequency_days: z.number().int().min(1).max(365).optional(),
});

export async function GET() {
  try {
    const session = await getDomainContext("groceries");
    if (!session) return unauthorized();
    await reconcileGroceryPurchases(session.ctx);
    return NextResponse.json(await listGroceries(session.ctx));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const session = await getDomainContext("groceries");
    if (!session) return unauthorized();
    const input = AddItem.parse(await request.json());
    const { data, error } = await session.ctx.db
      .from("grocery_lists")
      .insert({ principal_id: session.ctx.principalId, ...input })
      .select("*")
      .single();
    if (error) throw new Error(`grocery item insert failed: ${error.message}`);
    return NextResponse.json({ item: data }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const session = await getDomainContext("groceries");
    if (!session) return unauthorized();
    const body: unknown = await request.json();
    const kind = z.object({ kind: z.enum(["settings", "item"]) }).parse(body).kind;

    if (kind === "settings") {
      const input = UpdateSettings.parse(body);
      const { data, error } = await session.ctx.db
        .from("grocery_settings")
        .update({ weekly_budget_cents: input.weekly_budget_cents })
        .eq("principal_id", session.ctx.principalId)
        .select("*")
        .single();
      if (error) throw new Error(`grocery budget update failed: ${error.message}`);
      return NextResponse.json({ settings: data });
    }

    const input = UpdateItem.parse(body);
    const updates = {
      ...(input.quantity === undefined ? {} : { quantity: input.quantity }),
      ...(input.unit === undefined ? {} : { unit: input.unit }),
      ...(input.staple === undefined ? {} : { staple: input.staple }),
      ...(input.frequency_days === undefined ? {} : { frequency_days: input.frequency_days }),
    };
    const { data, error } = await session.ctx.db
      .from("grocery_lists")
      .update(updates)
      .eq("id", input.id)
      .eq("principal_id", session.ctx.principalId)
      .select("*")
      .single();
    if (error) throw new Error(`grocery item update failed: ${error.message}`);
    return NextResponse.json({ item: data });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const session = await getDomainContext("groceries");
    if (!session) return unauthorized();
    const id = z.string().uuid().parse(new URL(request.url).searchParams.get("id"));
    const { error } = await session.ctx.db
      .from("grocery_lists")
      .delete()
      .eq("id", id)
      .eq("principal_id", session.ctx.principalId);
    if (error) throw new Error(`grocery item delete failed: ${error.message}`);
    return NextResponse.json({ deleted: true });
  } catch (error) {
    return errorResponse(error);
  }
}

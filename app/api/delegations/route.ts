import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getDomainContext } from "@/lib/domain/server-context";
import { appendAuditEvent } from "@/lib/domain/audit";
import { errorResponse, unauthorized } from "@/lib/domain/http";

const Body = z
  .object({
    delegation_id: z.string().uuid(),
    max_amount_cents: z.number().int().positive().max(10_000_000),
    daily_limit_cents: z.number().int().positive().max(100_000_000),
    approval_threshold_cents: z.number().int().min(0).max(10_000_000),
    allow_recurring: z.boolean(),
    allowed_merchants: z.array(z.string().regex(/^[a-z0-9-]{1,64}$/)).max(50),
    status: z.enum(["active", "disabled"]),
  })
  .refine((d) => d.daily_limit_cents >= d.max_amount_cents, { message: "Daily limit must be at least the transaction limit." });

/** Policy edits go through the user's RLS-scoped client (column-restricted grant), then get audited. */
export async function PATCH(request: Request) {
  try {
    const body = Body.parse(await request.json());
    const session = await getDomainContext("dashboard");
    if (!session) return unauthorized();
    const supabase = await createClient();
    const { delegation_id, ...changes } = body;
    const { data, error } = await supabase.from("delegations").update(changes).eq("id", delegation_id).select("*").maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return NextResponse.json({ error: "NOT_FOUND", message: "Delegation not found." }, { status: 404 });
    await appendAuditEvent(session.ctx.db, {
      principalId: session.ctx.principalId,
      agentId: data.agent_id,
      eventType: "DELEGATION_UPDATED",
      eventData: { delegation_id, ...changes },
    });
    return NextResponse.json({ delegation: data });
  } catch (error) {
    return errorResponse(error);
  }
}

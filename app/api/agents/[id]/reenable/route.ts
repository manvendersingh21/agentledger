import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getDomainContext } from "@/lib/domain/server-context";
import { appendAuditEvent } from "@/lib/domain/audit";
import { errorResponse, unauthorized } from "@/lib/domain/http";

/** Human re-enables an agent after a kill switch. Goes through the user's RLS client (owner-only status grant). */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const session = await getDomainContext("dashboard");
    if (!session) return unauthorized();
    const supabase = await createClient();
    const { data, error } = await supabase.from("agents").update({ status: "active" }).eq("id", id).select("id, status").maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return NextResponse.json({ error: "NOT_FOUND", message: "Agent not found." }, { status: 404 });
    await session.ctx.db.from("agents").update({ suspended_at: null, suspended_reason: null }).eq("id", id).eq("owner_id", session.ctx.principalId);
    await appendAuditEvent(session.ctx.db, {
      principalId: session.ctx.principalId,
      agentId: id,
      eventType: "AGENT_REENABLED",
      eventData: { by: "principal", channel: "dashboard" },
    });
    return NextResponse.json({ agent: data });
  } catch (error) {
    return errorResponse(error, { agent_id: id });
  }
}

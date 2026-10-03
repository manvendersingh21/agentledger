import { NextResponse } from "next/server";
import { getDomainContext } from "@/lib/domain/server-context";
import { executeAction } from "@/lib/domain/pipeline";
import { errorResponse, unauthorized } from "@/lib/domain/http";

/** Re-invokes execution for an intent ("Simulate retry"). Idempotent: never charges twice. */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const session = await getDomainContext("retry");
    if (!session) return unauthorized();
    return NextResponse.json(await executeAction(session.ctx, id));
  } catch (error) {
    return errorResponse(error, { intent_id: id });
  }
}

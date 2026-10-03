import { NextResponse } from "next/server";
import { getDomainContext } from "@/lib/domain/server-context";
import { verifyPrincipalChain } from "@/lib/domain/audit";
import { errorResponse, unauthorized } from "@/lib/domain/http";

export async function GET() {
  try {
    const session = await getDomainContext("audit");
    if (!session) return unauthorized();
    return NextResponse.json(await verifyPrincipalChain(session.ctx.db, session.ctx.principalId));
  } catch (error) {
    return errorResponse(error);
  }
}

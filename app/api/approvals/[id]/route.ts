import { NextResponse } from "next/server";
import { z } from "zod";
import { getDomainContext } from "@/lib/domain/server-context";
import { resolveApproval } from "@/lib/domain/pipeline";
import { errorResponse, unauthorized } from "@/lib/domain/http";

const Body = z.object({ decision: z.enum(["approved", "denied"]), reason: z.string().max(500).optional() });

/** Human approval. resolve_approval enforces approval.principal_id = authenticated user and single use. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const session = await getDomainContext("dashboard");
    if (!session) return unauthorized();
    const body = Body.parse(await request.json());
    const result = await resolveApproval(session.ctx, id, body.decision, body.reason);
    return NextResponse.json(result);
  } catch (error) {
    return errorResponse(error, { approval_id: id });
  }
}

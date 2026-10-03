import { NextResponse } from "next/server";
import { checkout } from "@/lib/domain/groceries";
import { errorResponse, unauthorized } from "@/lib/domain/http";
import { getDomainContext } from "@/lib/domain/server-context";

export async function POST(request: Request) {
  try {
    const session = await getDomainContext("grocery");
    if (!session) return unauthorized();
    return NextResponse.json(await checkout(session.ctx, await request.json()));
  } catch (error) {
    return errorResponse(error);
  }
}

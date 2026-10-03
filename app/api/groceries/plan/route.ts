import { NextResponse } from "next/server";
import { planBasket } from "@/lib/domain/groceries";
import { errorResponse, unauthorized } from "@/lib/domain/http";
import { getDomainContext } from "@/lib/domain/server-context";

export async function POST() {
  try {
    const session = await getDomainContext("grocery");
    if (!session) return unauthorized();
    return NextResponse.json(await planBasket(session.ctx));
  } catch (error) {
    return errorResponse(error);
  }
}

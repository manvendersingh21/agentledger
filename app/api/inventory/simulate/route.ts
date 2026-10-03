import { NextResponse } from "next/server";
import { z } from "zod";
import { getDomainContext } from "@/lib/domain/server-context";
import { errorResponse, unauthorized } from "@/lib/domain/http";
import { simulateBusyNight } from "@/lib/domain/inventory";

const Body = z.object({ seed: z.number().int().optional() }).optional();

export async function POST(request: Request) {
  try {
    const session = await getDomainContext("inventory-simulate");
    if (!session) return unauthorized();
    let seed = 6103;
    try {
      const json = await request.json();
      const parsed = Body.parse(json);
      if (parsed?.seed !== undefined) seed = parsed.seed;
    } catch {
      // empty body is fine
    }
    const items = await simulateBusyNight(session.ctx, seed);
    return NextResponse.json({ items, seed });
  } catch (error) {
    return errorResponse(error);
  }
}

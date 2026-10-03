import { NextResponse } from "next/server";
import { getDomainContext } from "@/lib/domain/server-context";
import { resetDemo } from "@/lib/domain/pipeline";
import { errorResponse, unauthorized } from "@/lib/domain/http";
import { serverEnv } from "@/lib/env";

/** Demo/dev only. Resets the signed-in principal's own data; never touches other users. */
export async function POST() {
  if (!serverEnv.demoMode()) {
    return NextResponse.json({ error: "DISABLED", message: "Demo reset is only available when NEXT_PUBLIC_DEMO_MODE=true." }, { status: 403 });
  }
  try {
    const session = await getDomainContext("demo-reset");
    if (!session) return unauthorized();
    await resetDemo(session.ctx);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}

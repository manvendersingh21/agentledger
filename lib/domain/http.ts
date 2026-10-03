import "server-only";
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { NotAuthorizedError } from "./pipeline";

export const FAIL_CLOSED = "Action could not be evaluated safely, so AgentLedger denied execution.";

export function unauthorized() {
  return NextResponse.json({ error: "UNAUTHENTICATED", message: "Sign in required." }, { status: 401 });
}

/** Maps internal errors to understandable, fail-closed responses; logs the real cause server-side. */
export function errorResponse(error: unknown, context: Record<string, unknown> = {}) {
  if (error instanceof NotAuthorizedError) {
    return NextResponse.json({ error: "NOT_AUTHORIZED", message: error.message }, { status: 403 });
  }
  if (error instanceof ZodError) {
    return NextResponse.json({ error: "INVALID_INPUT", message: error.issues.map((i) => i.message).join("; ") }, { status: 400 });
  }
  console.error(JSON.stringify({ scope: "agentledger", message: "request failed", error: String(error), ...context }));
  return NextResponse.json({ error: "FAILED_CLOSED", message: FAIL_CLOSED }, { status: 500 });
}

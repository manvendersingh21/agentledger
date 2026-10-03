import { NextResponse } from "next/server";
import { getPrincipal } from "@/lib/auth/session";
import { verifyRegistration } from "@/lib/registry/registry";
import { errorResponse, unauthorized } from "@/lib/domain/http";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const principal = await getPrincipal();
    if (!principal) return unauthorized();
    const registration = await verifyRegistration(id, principal.id);
    return NextResponse.json({ registration });
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === "NOT_FOUND") {
        return NextResponse.json({ error: "NOT_FOUND", message: "Registration not found." }, { status: 404 });
      }
      if (error.message === "NOT_AUTHORIZED") {
        return NextResponse.json({ error: "NOT_AUTHORIZED", message: "Not allowed." }, { status: 403 });
      }
    }
    return errorResponse(error, { registration_id: id });
  }
}

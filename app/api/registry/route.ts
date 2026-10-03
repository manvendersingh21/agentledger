import { NextResponse } from "next/server";
import { z } from "zod";
import { getPrincipal } from "@/lib/auth/session";
import { createRegistration, listRegistrations } from "@/lib/registry/registry";
import { errorResponse, unauthorized } from "@/lib/domain/http";

const CreateBody = z.object({
  company_name: z.string().trim().min(1).max(200),
  domain: z
    .string()
    .trim()
    .min(3)
    .max(253)
    .transform((d) => d.toLowerCase())
    .refine(
      (d) =>
        /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/.test(d),
      { message: "Invalid domain hostname." },
    ),
  contact_email: z.string().trim().email().max(320),
  verification_method: z.enum(["dns_txt", "well_known"]),
});

export async function GET() {
  try {
    const principal = await getPrincipal();
    if (!principal) return unauthorized();
    const registrations = await listRegistrations(principal.id);
    return NextResponse.json({ registrations });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const principal = await getPrincipal();
    if (!principal) return unauthorized();
    const body = CreateBody.parse(await request.json());
    const registration = await createRegistration(principal.id, {
      companyName: body.company_name,
      domain: body.domain,
      contactEmail: body.contact_email,
      verificationMethod: body.verification_method,
    });
    return NextResponse.json({ registration }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}

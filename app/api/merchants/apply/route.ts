import { NextResponse } from "next/server";
import { z } from "zod";
import { errorResponse } from "@/lib/domain/http";
import { isValidTrustDomain, normalizeTrustDomain } from "@/lib/risk/scamadviser-scrape";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

const ApplicationBody = z.object({
  company_name: z.string().trim().min(1, "Company name is required.").max(200),
  domain: z
    .string()
    .trim()
    .min(1, "Domain is required.")
    .max(253)
    .transform(normalizeTrustDomain)
    .refine(isValidTrustDomain, {
      message: "Enter a valid public hostname (no IPs or localhost).",
    }),
  contact_name: z.string().trim().min(1, "Contact name is required.").max(200),
  contact_email: z.string().trim().email("Enter a valid work email.").max(320),
  message: z.string().trim().max(2000).default(""),
  website: z.string().max(500).default(""),
});

export async function POST(request: Request) {
  try {
    const raw: unknown = await request.json().catch(() => undefined);
    const application = ApplicationBody.parse(raw);

    // Honeypot submissions receive a normal response but are never persisted.
    if (application.website.length > 0) {
      return NextResponse.json({ received: true }, { status: 202 });
    }

    const admin = createAdminClient();
    const { error } = await admin.from("merchant_applications").insert({
      company_name: application.company_name,
      domain: application.domain,
      contact_name: application.contact_name,
      contact_email: application.contact_email,
      message: application.message,
      status: "new",
    });
    if (error) {
      throw new Error(`merchant application insert failed: ${error.message}`);
    }

    return NextResponse.json({ received: true }, { status: 201 });
  } catch (error) {
    return errorResponse(error, { route: "merchant_application" });
  }
}

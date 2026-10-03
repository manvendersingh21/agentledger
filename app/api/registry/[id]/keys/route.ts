import { NextResponse } from "next/server";
import { z } from "zod";
import { getPrincipal } from "@/lib/auth/session";
import { errorResponse, unauthorized } from "@/lib/domain/http";
import { generateMerchantApiKey } from "@/lib/registry/api-keys";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

const RegistrationId = z.string().uuid();
const RevokeBody = z.object({ key_id: z.string().uuid() }).strict();

type RegistrationRow = {
  id: string;
  owner_id: string;
  merchant_id: string | null;
  status: string;
};

type ProductRow = {
  id: string;
  name: string;
  description: string;
  price_cents: number;
  currency: string;
  recurring: boolean;
  metadata: unknown;
  category: string;
  attributes: unknown;
  market_price_cents: number | null;
  active: boolean;
  created_at: string;
};

function registrationNotFound() {
  return NextResponse.json(
    { error: "NOT_FOUND", message: "Merchant registration not found." },
    { status: 404 },
  );
}

function registrationNotVerified() {
  return NextResponse.json(
    {
      error: "MERCHANT_NOT_VERIFIED",
      message: "Verify this merchant registration before managing API keys.",
    },
    { status: 403 },
  );
}

async function loadOwnedRegistration(
  registrationId: string,
  ownerId: string,
): Promise<RegistrationRow | null> {
  const db = createAdminClient();
  const { data, error } = await db
    .from("merchant_registrations")
    .select("id, owner_id, merchant_id, status")
    .eq("id", registrationId)
    .eq("owner_id", ownerId)
    .maybeSingle();
  if (error) throw new Error(`merchant registration lookup failed: ${error.message}`);
  return data as RegistrationRow | null;
}

function productSku(metadata: unknown): string {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return "";
  const sku = (metadata as Record<string, unknown>).sku;
  return typeof sku === "string" ? sku : "";
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: rawId } = await params;
  try {
    const registrationId = RegistrationId.parse(rawId);
    const principal = await getPrincipal();
    if (!principal) return unauthorized();

    const registration = await loadOwnedRegistration(registrationId, principal.id);
    if (!registration) return registrationNotFound();
    if (registration.status !== "verified" || !registration.merchant_id) {
      return registrationNotVerified();
    }

    const db = createAdminClient();
    const [{ data: keys, error: keyError }, { data: productRows, error: productError }] =
      await Promise.all([
        db
          .from("merchant_api_keys")
          .select("id, key_prefix, created_at, revoked_at")
          .eq("registration_id", registration.id)
          .eq("owner_id", principal.id)
          .order("created_at", { ascending: false }),
        db
          .from("products")
          .select(
            "id, name, description, price_cents, currency, recurring, metadata, category, attributes, market_price_cents, active, created_at",
          )
          .eq("published_by_registration", registration.id)
          .eq("source", "merchant_feed")
          .order("created_at", { ascending: false }),
      ]);

    if (keyError) throw new Error(`merchant key listing failed: ${keyError.message}`);
    if (productError) {
      throw new Error(`merchant product listing failed: ${productError.message}`);
    }

    const products = ((productRows ?? []) as ProductRow[]).map((product) => ({
      id: product.id,
      sku: productSku(product.metadata),
      name: product.name,
      description: product.description,
      price_cents: product.price_cents,
      currency: product.currency,
      recurring: product.recurring,
      category: product.category,
      attributes: product.attributes,
      market_price_cents: product.market_price_cents,
      active: product.active,
      created_at: product.created_at,
    }));

    return NextResponse.json({ keys: keys ?? [], products });
  } catch (error) {
    return errorResponse(error, { registration_id: rawId });
  }
}

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: rawId } = await params;
  try {
    const registrationId = RegistrationId.parse(rawId);
    const principal = await getPrincipal();
    if (!principal) return unauthorized();

    const registration = await loadOwnedRegistration(registrationId, principal.id);
    if (!registration) return registrationNotFound();
    if (registration.status !== "verified" || !registration.merchant_id) {
      return registrationNotVerified();
    }

    const generated = await generateMerchantApiKey();
    const db = createAdminClient();
    const { data: inserted, error } = await db
      .from("merchant_api_keys")
      .insert({
        registration_id: registration.id,
        owner_id: principal.id,
        key_prefix: generated.keyPrefix,
        key_hash: generated.keyHash,
      })
      .select("id, key_prefix, created_at, revoked_at")
      .single();
    if (error || !inserted) {
      throw new Error(`merchant key creation failed: ${error?.message ?? "no row returned"}`);
    }

    return NextResponse.json(
      {
        api_key: generated.key,
        key: inserted,
        message: "Copy this API key now. It will not be shown again.",
      },
      { status: 201, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return errorResponse(error, { registration_id: rawId });
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: rawId } = await params;
  try {
    const registrationId = RegistrationId.parse(rawId);
    const principal = await getPrincipal();
    if (!principal) return unauthorized();

    const registration = await loadOwnedRegistration(registrationId, principal.id);
    if (!registration) return registrationNotFound();

    const body = RevokeBody.parse(await request.json());
    const db = createAdminClient();
    const { data: revoked, error } = await db
      .from("merchant_api_keys")
      .update({ revoked_at: new Date().toISOString() })
      .eq("id", body.key_id)
      .eq("registration_id", registration.id)
      .eq("owner_id", principal.id)
      .is("revoked_at", null)
      .select("id, key_prefix, created_at, revoked_at")
      .maybeSingle();
    if (error) throw new Error(`merchant key revocation failed: ${error.message}`);
    if (!revoked) {
      return NextResponse.json(
        { error: "NOT_FOUND", message: "Active API key not found." },
        { status: 404 },
      );
    }

    return NextResponse.json({ key: revoked });
  } catch (error) {
    return errorResponse(error, { registration_id: rawId });
  }
}

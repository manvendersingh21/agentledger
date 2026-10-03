import { NextResponse } from "next/server";
import { z } from "zod";
import { errorResponse } from "@/lib/domain/http";
import {
  hashMerchantApiKey,
  MERCHANT_API_KEY_PATTERN,
  verifyMerchantApiKey,
} from "@/lib/registry/api-keys";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

const ProductInput = z
  .object({
    sku: z.string().trim().min(1).max(100),
    name: z.string().trim().min(1).max(200),
    description: z.string().max(10_000),
    price_cents: z.number().int().min(0).max(2_147_483_647),
    currency: z.literal("usd"),
    recurring: z.boolean(),
    category: z.string().trim().min(1).max(100),
    attributes: z.record(z.string(), z.unknown()),
    market_price_cents: z.number().int().min(0).max(2_147_483_647).optional(),
  })
  .strict();

const FeedBody = z
  .object({
    products: z.array(ProductInput).min(1).max(100),
  })
  .strict()
  .superRefine(({ products }, context) => {
    const seen = new Set<string>();
    for (const [index, product] of products.entries()) {
      if (seen.has(product.sku)) {
        context.addIssue({
          code: "custom",
          message: `Duplicate SKU "${product.sku}" in request.`,
          path: ["products", index, "sku"],
        });
      }
      seen.add(product.sku);
    }
  });

type KeyRow = {
  registration_id: string;
  owner_id: string;
  key_hash: string;
  revoked_at: string | null;
};

type RegistrationRow = {
  id: string;
  owner_id: string;
  merchant_id: string | null;
  status: string;
};

function apiUnauthorized() {
  return NextResponse.json(
    { error: "INVALID_API_KEY", message: "A valid merchant API key is required." },
    { status: 401 },
  );
}

function merchantNotVerified() {
  return NextResponse.json(
    {
      error: "MERCHANT_NOT_VERIFIED",
      message: "This merchant registration is not verified.",
    },
    { status: 403 },
  );
}

function bearerKey(request: Request): string | null {
  const authorization = request.headers.get("authorization");
  const match = authorization?.match(/^Bearer ([^\s]+)$/i);
  const key = match?.[1] ?? null;
  return key && MERCHANT_API_KEY_PATTERN.test(key) ? key : null;
}

export async function POST(request: Request) {
  const key = bearerKey(request);
  if (!key) return apiUnauthorized();

  try {
    const db = createAdminClient();
    const keyHash = await hashMerchantApiKey(key);
    const { data: storedKey, error: keyError } = await db
      .from("merchant_api_keys")
      .select("registration_id, owner_id, key_hash, revoked_at")
      .eq("key_hash", keyHash)
      .maybeSingle();

    if (keyError) throw new Error(`merchant key lookup failed: ${keyError.message}`);
    const keyRow = storedKey as KeyRow | null;
    if (
      !keyRow ||
      keyRow.revoked_at !== null ||
      !(await verifyMerchantApiKey(key, keyRow.key_hash))
    ) {
      return apiUnauthorized();
    }

    const { data: storedRegistration, error: registrationError } = await db
      .from("merchant_registrations")
      .select("id, owner_id, merchant_id, status")
      .eq("id", keyRow.registration_id)
      .maybeSingle();

    if (registrationError) {
      throw new Error(`merchant registration lookup failed: ${registrationError.message}`);
    }
    const registration = storedRegistration as RegistrationRow | null;
    if (
      !registration ||
      registration.owner_id !== keyRow.owner_id ||
      registration.status !== "verified" ||
      !registration.merchant_id
    ) {
      return merchantNotVerified();
    }

    let rawBody: unknown;
    try {
      rawBody = await request.json();
    } catch {
      return NextResponse.json(
        { error: "INVALID_INPUT", message: "Request body must be valid JSON." },
        { status: 400 },
      );
    }
    const body = FeedBody.parse(rawBody);
    const products = body.products.map((product) => ({
      ...product,
      market_price_cents: product.market_price_cents ?? null,
    }));

    const { data, error } = await db.rpc("upsert_merchant_feed_products", {
      p_registration_id: registration.id,
      p_products: products,
    });
    if (error) throw new Error(`merchant catalog upsert failed: ${error.message}`);

    return NextResponse.json({
      upserted: Array.isArray(data) ? data.length : 0,
      products: data ?? [],
    });
  } catch (error) {
    return errorResponse(error, { route: "merchant_product_feed" });
  }
}

import "server-only";
import { randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import {
  checkDnsTxt,
  checkWellKnown,
  type MerchantRegistration,
  type RegistrationStatus,
  type VerificationMethod,
} from "@/lib/registry/verify";

export type { MerchantRegistration, RegistrationStatus, VerificationMethod };

export interface CreateRegistrationInput {
  companyName: string;
  domain: string;
  contactEmail: string;
  verificationMethod: VerificationMethod;
}

function normalizeDomain(domain: string): string {
  return domain.trim().toLowerCase().replace(/\.+$/, "");
}

function domainToSlug(domain: string): string {
  return normalizeDomain(domain).replace(/\./g, "-");
}

function generateVerificationToken(): string {
  return randomBytes(32).toString("hex");
}

function rowToRegistration(row: Record<string, unknown>): MerchantRegistration {
  return {
    id: String(row.id),
    owner_id: String(row.owner_id),
    merchant_id: row.merchant_id ? String(row.merchant_id) : null,
    company_name: String(row.company_name),
    domain: String(row.domain),
    contact_email: String(row.contact_email),
    verification_method: row.verification_method as VerificationMethod,
    verification_token: String(row.verification_token),
    status: row.status as RegistrationStatus,
    verified_at: row.verified_at ? String(row.verified_at) : null,
    last_checked_at: row.last_checked_at ? String(row.last_checked_at) : null,
    last_error: row.last_error ? String(row.last_error) : null,
    created_at: String(row.created_at),
  };
}

export async function listRegistrations(ownerId: string): Promise<MerchantRegistration[]> {
  const db = await createClient();
  const { data, error } = await db
    .from("merchant_registrations")
    .select("*")
    .eq("owner_id", ownerId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => rowToRegistration(row as Record<string, unknown>));
}

export async function createRegistration(
  ownerId: string,
  input: CreateRegistrationInput,
): Promise<MerchantRegistration> {
  const admin = createAdminClient();
  const domain = normalizeDomain(input.domain);
  const token = generateVerificationToken();
  const { data, error } = await admin
    .from("merchant_registrations")
    .insert({
      owner_id: ownerId,
      company_name: input.companyName.trim(),
      domain,
      contact_email: input.contactEmail.trim(),
      verification_method: input.verificationMethod,
      verification_token: token,
      status: "pending",
    })
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return rowToRegistration(data as Record<string, unknown>);
}

async function linkVerifiedMerchant(
  admin: SupabaseClient,
  registration: MerchantRegistration,
): Promise<string> {
  const now = new Date().toISOString();
  const domain = registration.domain;
  const { data: byDomain } = await admin
    .from("merchants")
    .select("id, slug")
    .eq("domain", domain)
    .maybeSingle();

  if (byDomain?.id) {
    const { error } = await admin
      .from("merchants")
      .update({ verified: true, verified_at: now, name: registration.company_name })
      .eq("id", byDomain.id);
    if (error) throw new Error(error.message);
    return String(byDomain.id);
  }

  const slug = domainToSlug(domain);
  const { data: bySlug } = await admin.from("merchants").select("id").eq("slug", slug).maybeSingle();
  if (bySlug?.id) {
    const { error } = await admin
      .from("merchants")
      .update({
        verified: true,
        verified_at: now,
        domain,
        name: registration.company_name,
      })
      .eq("id", bySlug.id);
    if (error) throw new Error(error.message);
    return String(bySlug.id);
  }

  const { data: inserted, error: insertError } = await admin
    .from("merchants")
    .insert({
      slug,
      name: registration.company_name,
      domain,
      trusted: false,
      verified: true,
      verified_at: now,
      trust_score_source: "unavailable",
    })
    .select("id")
    .single();
  if (insertError) throw new Error(insertError.message);
  return String(inserted.id);
}

export async function verifyRegistration(
  registrationId: string,
  ownerId: string,
): Promise<MerchantRegistration> {
  const admin = createAdminClient();
  const { data: row, error: loadError } = await admin
    .from("merchant_registrations")
    .select("*")
    .eq("id", registrationId)
    .maybeSingle();
  if (loadError) throw new Error(loadError.message);
  if (!row) throw new Error("NOT_FOUND");
  const registration = rowToRegistration(row as Record<string, unknown>);
  if (registration.owner_id !== ownerId) throw new Error("NOT_AUTHORIZED");

  const checkedAt = new Date().toISOString();
  const check =
    registration.verification_method === "dns_txt"
      ? await checkDnsTxt(registration.domain, registration.verification_token)
      : await checkWellKnown(registration.domain, registration.verification_token);

  if (!check.ok) {
    const { data: failed, error } = await admin
      .from("merchant_registrations")
      .update({
        status: "failed",
        last_checked_at: checkedAt,
        last_error: check.error ?? "Verification failed.",
      })
      .eq("id", registrationId)
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return rowToRegistration(failed as Record<string, unknown>);
  }

  const merchantId = await linkVerifiedMerchant(admin, registration);
  const { data: verified, error: verifyError } = await admin
    .from("merchant_registrations")
    .update({
      status: "verified",
      verified_at: checkedAt,
      last_checked_at: checkedAt,
      last_error: null,
      merchant_id: merchantId,
    })
    .eq("id", registrationId)
    .select("*")
    .single();
  if (verifyError) throw new Error(verifyError.message);
  return rowToRegistration(verified as Record<string, unknown>);
}

export interface PublicVerifiedMerchant {
  domain: string;
  verified: boolean;
  companyName: string | null;
  verifiedAt: string | null;
  isDemoFixture: boolean;
  merchantSlug: string | null;
}

export async function getPublicVerifiedByDomain(domain: string): Promise<PublicVerifiedMerchant> {
  const admin = createAdminClient();
  const normalized = normalizeDomain(domain);
  const { data: merchant } = await admin
    .from("merchants")
    .select("slug, name, verified, verified_at, trust_score_source")
    .eq("domain", normalized)
    .maybeSingle();

  if (merchant) {
    return {
      domain: normalized,
      verified: Boolean(merchant.verified),
      companyName: merchant.name ?? null,
      verifiedAt: merchant.verified_at ? String(merchant.verified_at) : null,
      isDemoFixture: merchant.trust_score_source === "fixture",
      merchantSlug: merchant.slug ? String(merchant.slug) : null,
    };
  }

  const { data: registration } = await admin
    .from("merchant_registrations")
    .select("company_name, status, verified_at")
    .eq("domain", normalized)
    .eq("status", "verified")
    .maybeSingle();

  return {
    domain: normalized,
    verified: Boolean(registration),
    companyName: registration?.company_name ? String(registration.company_name) : null,
    verifiedAt: registration?.verified_at ? String(registration.verified_at) : null,
    isDemoFixture: false,
    merchantSlug: null,
  };
}

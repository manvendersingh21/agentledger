import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { getPrincipal, type Principal } from "@/lib/auth/session";
import { createPaymentProvider } from "@/lib/payments/provider";
import { serverEnv } from "@/lib/env";
import { ensurePrincipalSetup, type DomainContext } from "./pipeline";

/** Builds a DomainContext for the signed-in user. Identity comes from Supabase Auth only. */
export async function getDomainContext(channel: string): Promise<{ ctx: DomainContext; principal: Principal } | null> {
  const principal = await getPrincipal();
  if (!principal) return null;
  const db = createAdminClient();
  const agentId = await ensurePrincipalSetup(db, principal.id, principal.displayName);
  const payments = createPaymentProvider({
    preferred: serverEnv.paymentProvider(),
    stripeSecretKey: serverEnv.stripeSecretKey(),
  });
  return { ctx: { db, principalId: principal.id, agentId, payments, channel }, principal };
}

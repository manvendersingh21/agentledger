import "server-only";
import { createClient } from "@supabase/supabase-js";
import { serverEnv } from "@/lib/env";

/**
 * Privileged client (secret key). Server-only. Used exclusively by domain operations
 * after the caller's identity has been established from Supabase Auth.
 */
export function createAdminClient() {
  return createClient(serverEnv.supabaseUrl(), serverEnv.supabaseSecretKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

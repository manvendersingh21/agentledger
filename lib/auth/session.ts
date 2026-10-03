import "server-only";
import { createClient } from "@/lib/supabase/server";

export interface Principal {
  id: string;
  email: string | null;
  displayName: string;
}

/** Identity comes only from Supabase Auth (verified JWT), never from request bodies. */
export async function getPrincipal(): Promise<Principal | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;
  const email = data.user.email ?? null;
  return {
    id: data.user.id,
    email,
    displayName: (data.user.user_metadata?.display_name as string | undefined) ?? email?.split("@")[0] ?? "user",
  };
}

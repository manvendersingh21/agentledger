import { listRegistrations } from "@/lib/registry/registry";
import { getPrincipal } from "@/lib/auth/session";
import { RegistryClient } from "./registry-client";

export const dynamic = "force-dynamic";

export default async function RegistryPage() {
  const principal = await getPrincipal();
  if (!principal) {
    return null;
  }
  const registrations = await listRegistrations(principal.id);

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">Merchant registry</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Register your company domain and prove you control it. Verification proves the merchant
          controls the domain. It does not make a merchant safe; your delegation policy still
          decides.
        </p>
      </header>
      <RegistryClient initialRegistrations={registrations} />
    </div>
  );
}

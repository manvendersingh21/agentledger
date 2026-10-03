import { listRegistrations } from "@/lib/registry/registry";
import { getPrincipal } from "@/lib/auth/session";
import { RegistryClient } from "./registry-client";
import { Eyebrow } from "@/components/brand/eyebrow";

export const dynamic = "force-dynamic";

export default async function RegistryPage() {
  const principal = await getPrincipal();
  if (!principal) {
    return null;
  }
  const registrations = await listRegistrations(principal.id);

  return (
    <div className="space-y-10">
      <header className="space-y-4">
        <Eyebrow>Registry</Eyebrow>
        <h1 className="font-display text-[44px] font-semibold leading-[0.95] tracking-[-0.045em] text-ink sm:text-[56px]">
          Merchant <span className="text-accent">registry</span>
        </h1>
        <p className="max-w-2xl text-base text-ink-2">
          Register your company domain and prove you control it. Verification proves the merchant
          controls the domain. It does not make a merchant safe; your delegation policy still
          decides.
        </p>
      </header>
      <RegistryClient initialRegistrations={registrations} />
    </div>
  );
}

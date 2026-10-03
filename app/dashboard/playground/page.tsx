import { ensureSetup, getDelegation, getPendingApprovals } from "@/lib/data/queries";
import { Eyebrow } from "@/components/brand/eyebrow";
import { PlaygroundClient } from "./playground-client";

export const dynamic = "force-dynamic";

export default async function PlaygroundPage() {
  const { principal, paymentProviderLabel } = await ensureSetup();
  const [delegation, pendingApprovals] = await Promise.all([getDelegation(), getPendingApprovals()]);

  return (
    <div className="space-y-10">
      <header className="space-y-4">
        <Eyebrow>Live demo</Eyebrow>
        <h1 className="font-display text-[44px] font-semibold leading-[0.95] tracking-[-0.045em] text-ink sm:text-[56px]">
          Agent <span className="text-accent">Playground</span>
        </h1>
        <p className="max-w-2xl text-[15px] leading-relaxed text-ink-2">
          Run a purchasing agent against your delegation. Policy evaluation and execution stay on
          AgentLedger — the model only proposes.
        </p>
      </header>

      <PlaygroundClient
        userId={principal.id}
        pendingApprovals={pendingApprovals}
        delegation={delegation}
        paymentProviderLabel={paymentProviderLabel}
      />
    </div>
  );
}

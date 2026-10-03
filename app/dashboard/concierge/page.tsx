import { ensureSetup, getPendingApprovals } from "@/lib/data/queries";
import { Eyebrow } from "@/components/brand/eyebrow";
import { ConciergeClient } from "./concierge-client";

export const dynamic = "force-dynamic";

export default async function ConciergePage() {
  const { principal } = await ensureSetup();
  const pendingApprovals = await getPendingApprovals();

  return (
    <div className="space-y-8 pb-6">
      <header className="space-y-3">
        <Eyebrow>Concierge</Eyebrow>
        <h1 className="font-display text-[40px] font-semibold leading-[0.95] tracking-[-0.045em] text-ink sm:text-[52px]">
          Shop with <span className="text-accent">guardrails</span>
        </h1>
        <p className="max-w-2xl text-[15px] leading-relaxed text-ink-2">
          Describe what you need — the concierge asks a few questions, recommends products, and proposes purchases
          through AgentLedger policy. You stay in control of approvals and limits.
        </p>
      </header>

      <ConciergeClient userId={principal.id} pendingApprovals={pendingApprovals} />
    </div>
  );
}

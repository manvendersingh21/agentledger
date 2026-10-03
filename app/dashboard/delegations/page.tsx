import { ensureSetup, getAgents, getDelegation, getMerchants } from "@/lib/data/queries";
import { DelegationEditor } from "@/components/policy/delegation-editor";
import { Eyebrow } from "@/components/brand/eyebrow";

export const dynamic = "force-dynamic";

export default async function DelegationsPage() {
  await ensureSetup();
  const [delegation, merchants, agents] = await Promise.all([
    getDelegation(),
    getMerchants(),
    getAgents(),
  ]);

  const agentName =
    agents.find((a) => a.id === delegation?.agent_id)?.name ?? "Your agent";

  return (
    <div className="space-y-10">
      <header className="space-y-4">
        <Eyebrow>Authorization</Eyebrow>
        <h1 className="font-display text-[44px] font-semibold leading-[0.95] tracking-[-0.045em] text-ink sm:text-[56px]">
          Delegation
        </h1>
        <p className="max-w-2xl text-base text-ink-2">
          Define what your agent may propose. Policy evaluation uses these limits — not what the
          model claims.
        </p>
      </header>

      {!delegation ? (
        <p className="rounded-[6px] border border-line bg-surface px-6 py-12 text-center text-sm text-ink-2">
          No delegation found. Visit the overview to complete setup.
        </p>
      ) : (
        <DelegationEditor
          delegation={delegation}
          merchants={merchants}
          agentName={agentName}
        />
      )}
    </div>
  );
}

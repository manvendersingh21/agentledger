import { ensureSetup, getAgents, getDelegation, getMerchants } from "@/lib/data/queries";
import { DelegationEditor } from "@/components/policy/delegation-editor";

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
    <div className="space-y-6">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">Delegation</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Define what your agent may propose. Policy evaluation uses these limits — not what the
          model claims.
        </p>
      </header>

      {!delegation ? (
        <p className="rounded-lg border border-border bg-muted/20 px-4 py-8 text-center text-sm text-muted-foreground">
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

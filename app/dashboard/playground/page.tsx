import { ensureSetup, getDelegation, getPendingApprovals } from "@/lib/data/queries";
import { PlaygroundClient } from "./playground-client";

export const dynamic = "force-dynamic";

export default async function PlaygroundPage() {
  const { principal, paymentProviderLabel } = await ensureSetup();
  const [delegation, pendingApprovals] = await Promise.all([getDelegation(), getPendingApprovals()]);

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">Agent Playground</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
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

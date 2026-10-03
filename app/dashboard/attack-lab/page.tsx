import { ensureSetup } from "@/lib/data/queries";
import { AttackLabClient } from "./attack-lab-client";

export const dynamic = "force-dynamic";

export default async function AttackLabPage() {
  await ensureSetup();

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">Attack Lab</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          One-click adversarial scenarios against the real policy and execution pipeline — nothing
          mocked, no bypass paths.
        </p>
      </header>
      <AttackLabClient />
    </div>
  );
}

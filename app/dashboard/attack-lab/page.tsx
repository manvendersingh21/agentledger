import { ensureSetup } from "@/lib/data/queries";
import { AttackLabClient } from "./attack-lab-client";
import { Eyebrow } from "@/components/brand/eyebrow";

export const dynamic = "force-dynamic";

export default async function AttackLabPage() {
  await ensureSetup();

  return (
    <div className="space-y-10">
      <header className="space-y-4">
        <Eyebrow>Red team</Eyebrow>
        <h1 className="font-display text-[44px] font-semibold leading-[0.95] tracking-[-0.045em] text-ink sm:text-[56px]">
          Attack <span className="text-accent">Lab</span>
        </h1>
        <p className="max-w-2xl text-base text-ink-2">
          One-click adversarial scenarios against the real policy and execution pipeline — nothing
          mocked, no bypass paths.
        </p>
      </header>
      <AttackLabClient />
    </div>
  );
}

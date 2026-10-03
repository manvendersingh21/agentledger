import { ensureSetup, getDelegation } from "@/lib/data/queries";
import { Eyebrow } from "@/components/brand/eyebrow";
import { ScenariosClient } from "./scenarios-client";

export const dynamic = "force-dynamic";

export default async function ScenariosPage() {
  await ensureSetup();
  const delegation = await getDelegation();

  return (
    <div className="space-y-10">
      <header className="space-y-4">
        <Eyebrow>Demo presets</Eyebrow>
        <h1 className="font-display text-[44px] font-semibold leading-[0.95] tracking-[-0.045em] text-ink sm:text-[56px]">
          Real-life <span className="text-accent">scenarios</span>
        </h1>
        <p className="max-w-2xl text-[15px] leading-relaxed text-ink-2">
          One click rewrites your delegation for a different buying context — same deterministic policy engine,
          different limits and categories. Then jump into Concierge, Inventory, or the Playground.
        </p>
      </header>
      <ScenariosClient activeScenario={delegation?.scenario ?? "software"} />
    </div>
  );
}

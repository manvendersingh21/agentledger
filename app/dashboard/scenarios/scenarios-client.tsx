"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Loader2 } from "lucide-react";
import { ArrowButton } from "@/components/brand/arrow-button";
import { cn } from "@/lib/utils";

type ScenarioKey = "home" | "diy" | "restaurant" | "software";

interface ScenarioCard {
  key: ScenarioKey;
  title: string;
  story: string;
  policy: string;
  href: string;
  hrefLabel: string;
}

const CARDS: ScenarioCard[] = [
  {
    key: "home",
    title: "Home shopper",
    story: "Beat a heat wave — find the right fan for your room without overspending.",
    policy:
      "Home appliances only: up to $150 per purchase, $300 per day; human approval above $60. Crypto, gift cards, and wires stay blocked.",
    href: "/dashboard/concierge",
    hrefLabel: "Open Concierge",
  },
  {
    key: "diy",
    title: "DIY weekend",
    story: "Shelf project Saturday — drill, bits, and hardware within a tight tool budget.",
    policy:
      "DIY tools and supplies: up to $100 per purchase, $200 per day; approval above $50. Blocked categories unchanged.",
    href: "/dashboard/concierge",
    hrefLabel: "Open Concierge",
  },
  {
    key: "restaurant",
    title: "Restaurant autopilot",
    story: "Friday rush drained the pantry — autopilot restocks oil, flour, and gloves from trusted suppliers.",
    policy:
      "Restaurant food and supplies: up to $120 per purchase, $600 per day; routine restocks under $75 can auto-buy.",
    href: "/dashboard/inventory",
    hrefLabel: "Open Inventory",
  },
  {
    key: "software",
    title: "Software API",
    story: "Original demo — agent shops developer API plans from trusted software merchants.",
    policy:
      "Software/API merchants: up to $20 per purchase, $50 per day; approval above $10. Same guardrails as the launch demo.",
    href: "/dashboard/playground",
    hrefLabel: "Open Playground",
  },
];

export function ScenariosClient({ activeScenario }: { activeScenario: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState<ScenarioKey | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function applyScenario(key: ScenarioKey) {
    setLoading(key);
    setError(null);
    try {
      const res = await fetch("/api/scenarios/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scenario: key }),
      });
      const body = (await res.json()) as { message?: string; error?: string };
      if (!res.ok) {
        setError(body.message ?? body.error ?? "Could not apply scenario.");
        return;
      }
      router.refresh();
    } catch {
      setError("Network error. Try again.");
    } finally {
      setLoading(null);
    }
  }

  return (
    <div className="space-y-6">
      {error ? (
        <p className="rounded-[6px] bg-blocked-bg px-5 py-4 text-sm font-medium text-blocked">{error}</p>
      ) : null}
      <div className="grid gap-6 lg:grid-cols-2">
        {CARDS.map((card) => {
          const isActive = activeScenario === card.key;
          const busy = loading === card.key;
          return (
            <article
              key={card.key}
              className={cn(
                "flex flex-col gap-6 rounded-[6px] border p-6 sm:p-8",
                isActive ? "border-accent bg-accent-wash" : "border-line bg-surface",
              )}
            >
              <div className="space-y-2">
                {isActive ? (
                  <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-accent">Active preset</p>
                ) : (
                  <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-3">Scenario</p>
                )}
                <h2 className="font-display text-3xl font-semibold leading-[0.95] tracking-[-0.045em] text-ink">
                  {card.title}
                </h2>
                <p className="text-[15px] leading-relaxed text-ink-2">{card.story}</p>
              </div>
              <p className="rounded-[4px] border border-line bg-canvas px-4 py-3 text-sm leading-relaxed text-ink-2">
                {card.policy}
              </p>
              <div className="mt-auto flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
                <ArrowButton
                  type="button"
                  disabled={loading !== null}
                  onClick={() => void applyScenario(card.key)}
                  className={busy ? "opacity-80" : undefined}
                >
                  {busy ? (
                    <span className="inline-flex items-center gap-2">
                      <Loader2 className="size-4 animate-spin" aria-hidden />
                      Applying…
                    </span>
                  ) : (
                    "Use this scenario"
                  )}
                </ArrowButton>
                <Link
                  href={card.href}
                  className="text-sm font-medium text-accent hover:text-accent-hover hover:underline"
                >
                  {card.hrefLabel} →
                </Link>
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}

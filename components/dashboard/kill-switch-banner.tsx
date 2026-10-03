"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import { Loader2, OctagonAlert } from "lucide-react";
import type { AgentRow } from "@/lib/data/types";
import { useLedgerRealtime, type LedgerChange } from "@/lib/realtime/use-ledger-realtime";
import { useRefreshScheduler } from "@/lib/realtime/refresh-scheduler";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { LocalDateTime } from "@/components/local-time";

export type SuspendedAgentSummary = Pick<
  AgentRow,
  "id" | "name" | "suspended_at" | "suspended_reason"
>;

export function ReenableAgentButton({
  agentId,
  size = "sm",
  className,
}: {
  agentId: string;
  size?: "sm" | "md";
  className?: string;
}) {
  const { suspendRealtimeRefresh, refreshNow } = useRefreshScheduler();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function reenable() {
    setError(null);
    setLoading(true);
    try {
      const res = await fetch(`/api/agents/${agentId}/reenable`, { method: "POST" });
      const body = (await res.json()) as { message?: string; error?: string };
      if (!res.ok) {
        setError(body.message ?? body.error ?? "Could not re-enable agent.");
        return;
      }
      suspendRealtimeRefresh(1500);
      refreshNow();
    } catch {
      setError("Network error.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <span className={cn("inline-flex flex-wrap items-center gap-2", className)}>
      <Button
        type="button"
        size={size}
        disabled={loading}
        className="rounded border border-inverse bg-inverse font-semibold text-white hover:bg-ink hover:text-white"
        onClick={() => void reenable()}
      >
        {loading ? <Loader2 className="size-4 animate-spin" /> : null}
        Re-enable agent
      </Button>
      {error ? <span className="text-xs font-medium text-current">{error}</span> : null}
    </span>
  );
}

export interface KillSwitchBannerProps {
  userId: string;
  suspendedAgents: SuspendedAgentSummary[];
}

export function KillSwitchBanner({ userId, suspendedAgents }: KillSwitchBannerProps) {
  const { requestRealtimeRefresh } = useRefreshScheduler();

  const onRealtime = useCallback(
    (change: LedgerChange) => {
      if (change.table === "agents") requestRealtimeRefresh();
    },
    [requestRealtimeRefresh],
  );

  useLedgerRealtime(userId, onRealtime);

  if (suspendedAgents.length === 0) return null;

  const primary = suspendedAgents[0];
  const reason = primary.suspended_reason?.trim() || "Kill switch triggered";
  const when = primary.suspended_at ? (
    <LocalDateTime iso={primary.suspended_at} className="font-mono" />
  ) : (
    "recently"
  );

  return (
    <div role="alert" className="w-full bg-blocked text-white">
      <div className="mx-auto flex w-full max-w-[1440px] flex-col gap-4 px-4 py-4 md:flex-row md:items-center md:justify-between md:px-6">
        <div className="flex min-w-0 items-start gap-3">
          <span className="inline-flex size-10 shrink-0 items-center justify-center rounded bg-white text-blocked">
            <OctagonAlert className="size-5" aria-hidden />
          </span>
          <div className="min-w-0 space-y-1">
            <p className="font-display text-[20px] font-bold leading-tight tracking-[-0.02em] md:text-[22px]">
              <span className="mr-2 inline-block rounded-sm bg-white px-1.5 py-0.5 align-middle text-[11px] font-bold uppercase tracking-[0.14em] text-blocked">
                Agent halted
              </span>
              AgentLedger kill switch suspended {primary.name}
            </p>
            <p className="text-[13px] text-white/85">
              {reason} · {when}
              {suspendedAgents.length > 1
                ? ` · +${suspendedAgents.length - 1} more agent${suspendedAgents.length > 2 ? "s" : ""}`
                : null}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2 text-white">
          <Link
            href="/dashboard/audit"
            className="inline-flex h-8 items-center justify-center rounded border border-white bg-white px-3 text-xs font-semibold text-blocked transition-colors hover:bg-blocked-bg"
          >
            Review timeline
          </Link>
          <ReenableAgentButton agentId={primary.id} />
        </div>
      </div>
    </div>
  );
}

"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import { Loader2, OctagonAlert } from "lucide-react";
import type { AgentRow } from "@/lib/data/types";
import { useLedgerRealtime } from "@/lib/realtime/use-ledger-realtime";
import { Button } from "@/components/ui/button";
import { cn, formatDateTime } from "@/lib/utils";

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
  const router = useRouter();
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
      router.refresh();
    } catch {
      setError("Network error.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <span className={className}>
      <Button
        type="button"
        variant="outline"
        size={size}
        disabled={loading}
        className="border-red-400/40 bg-red-950/40 text-red-100 hover:bg-red-950/60"
        onClick={() => void reenable()}
      >
        {loading ? <Loader2 className="size-4 animate-spin" /> : null}
        Re-enable agent
      </Button>
      {error ? <span className="ml-2 text-xs text-red-200">{error}</span> : null}
    </span>
  );
}

export interface KillSwitchBannerProps {
  userId: string;
  suspendedAgents: SuspendedAgentSummary[];
}

export function KillSwitchBanner({ userId, suspendedAgents }: KillSwitchBannerProps) {
  const router = useRouter();

  const onRealtime = useCallback(
    (change: { table: string }) => {
      if (change.table === "agents") {
        router.refresh();
      }
    },
    [router],
  );

  useLedgerRealtime(userId, onRealtime as Parameters<typeof useLedgerRealtime>[1]);

  if (suspendedAgents.length === 0) return null;

  const primary = suspendedAgents[0];
  const reason = primary.suspended_reason?.trim() || "Kill switch triggered";
  const when = primary.suspended_at ? formatDateTime(primary.suspended_at) : "recently";

  return (
    <div
      role="alert"
      className="border-b border-red-500/50 bg-red-600/15 px-4 py-3 text-red-100 md:px-8"
    >
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <OctagonAlert className="mt-0.5 size-5 shrink-0 text-red-400" aria-hidden />
          <div className="min-w-0 space-y-1">
            <p className="text-sm font-semibold tracking-tight text-red-300">
              AGENT HALTED — AgentLedger kill switch suspended {primary.name}
            </p>
            <p className="text-xs text-red-200/90">
              {reason} · {when}
              {suspendedAgents.length > 1
                ? ` · +${suspendedAgents.length - 1} more agent${suspendedAgents.length > 2 ? "s" : ""}`
                : null}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <Link
            href="/dashboard/audit"
            className={cn(
              "inline-flex h-8 items-center justify-center rounded-md border border-red-400/40 bg-transparent px-3 text-xs font-medium text-red-100 hover:bg-red-950/40",
            )}
          >
            Review timeline
          </Link>
          <ReenableAgentButton agentId={primary.id} />
        </div>
      </div>
    </div>
  );
}

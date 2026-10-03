"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Inbox } from "lucide-react";
import type { PendingApproval } from "@/lib/data/types";
import { useLedgerRealtime, type LedgerChange } from "@/lib/realtime/use-ledger-realtime";
import {
  ApprovalCard,
  type ApprovalResolveResponse,
} from "@/components/approvals/approval-card";
import {
  playApprovalChime,
  vibrateForApproval,
} from "@/app/dashboard/approvals/approval-sound";
import { cn } from "@/lib/utils";

const DEFAULT_TITLE = "AgentLedger";

export interface LiveApprovalsProps {
  userId: string;
  initial: PendingApproval[];
  compact?: boolean;
  /** Keep resolved cards visible locally before refreshing server data. */
  resolvedHoldMs?: number;
  onApprovalResolved?: (outcome: ApprovalResolveResponse) => void;
  /** Mobile-first layout for the approvals page (sticky actions, arrival alerts). */
  mobilePresenter?: boolean;
}

function isNewPendingApproval(change: LedgerChange): boolean {
  if (change.table !== "approvals" || change.operation !== "INSERT") return false;
  const status = change.record?.status;
  return status === "pending";
}

export function LiveApprovals({
  userId,
  initial,
  compact,
  resolvedHoldMs = 0,
  onApprovalResolved,
  mobilePresenter = false,
}: LiveApprovalsProps) {
  const router = useRouter();
  const holdUntilRef = useRef(0);
  const knownPendingRef = useRef<Set<string>>(new Set(initial.map((p) => p.approval.id)));
  const [arrivalPulse, setArrivalPulse] = useState(false);

  useEffect(() => {
    knownPendingRef.current = new Set(initial.map((p) => p.approval.id));
  }, [initial]);

  useEffect(() => {
    if (compact) return;
    const count = initial.length;
    document.title =
      count > 0 ? `(${count}) Approval needed — AgentLedger` : DEFAULT_TITLE;
    return () => {
      document.title = DEFAULT_TITLE;
    };
  }, [compact, initial.length]);

  const notifyArrival = useCallback(() => {
    setArrivalPulse(true);
    vibrateForApproval();
    playApprovalChime();
    window.setTimeout(() => setArrivalPulse(false), 1200);
  }, []);

  const scheduleRefresh = useCallback(() => {
    if (resolvedHoldMs <= 0) {
      router.refresh();
      return;
    }
    holdUntilRef.current = Date.now() + resolvedHoldMs;
    window.setTimeout(() => {
      if (Date.now() >= holdUntilRef.current) {
        router.refresh();
      }
    }, resolvedHoldMs);
  }, [resolvedHoldMs, router]);

  const onChange = useCallback(
    (change: LedgerChange) => {
      if (isNewPendingApproval(change)) {
        const id = typeof change.record?.id === "string" ? change.record.id : null;
        if (id && !knownPendingRef.current.has(id)) {
          knownPendingRef.current.add(id);
          if (!compact) notifyArrival();
        }
      }

      if (Date.now() < holdUntilRef.current) return;
      if (change.table === "approvals" || change.table === "action_intents") {
        router.refresh();
      }
    },
    [compact, notifyArrival, router],
  );

  useLedgerRealtime(userId, onChange);

  const handleResolved = useCallback(
    (outcome: ApprovalResolveResponse) => {
      onApprovalResolved?.(outcome);
      scheduleRefresh();
    },
    [onApprovalResolved, scheduleRefresh],
  );

  if (initial.length === 0) {
    return (
      <div
        className={cn(
          "flex w-full max-w-full flex-col items-center justify-center gap-3 rounded-[6px] border border-dashed border-line bg-surface text-center",
          compact ? "px-4 py-8" : "px-6 py-16",
        )}
      >
        <span className="flex size-10 items-center justify-center rounded-[4px] bg-accent-wash text-accent">
          <Inbox className="size-5" aria-hidden />
        </span>
        <p className="text-[15px] font-medium text-ink">No actions awaiting your approval</p>
        {!compact ? (
          <p className="max-w-sm text-sm text-ink-3">
            New requests appear here in real time when an agent crosses your approval threshold.
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <ul
      className={cn(
        compact ? "space-y-3" : "space-y-4",
        arrivalPulse && mobilePresenter && "motion-safe:animate-pulse",
      )}
    >
      {initial.map((item, index) => (
        <li key={item.approval.id} className="w-full min-w-0">
          <ApprovalCard
            item={item}
            onResolved={handleResolved}
            stickyMobileActions={mobilePresenter && index === 0}
          />
        </li>
      ))}
    </ul>
  );
}

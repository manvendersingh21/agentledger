"use client";

import { useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { Inbox } from "lucide-react";
import type { PendingApproval } from "@/lib/data/types";
import { useLedgerRealtime, type LedgerChange } from "@/lib/realtime/use-ledger-realtime";
import {
  ApprovalCard,
  type ApprovalResolveResponse,
} from "@/components/approvals/approval-card";
import { cn } from "@/lib/utils";

export interface LiveApprovalsProps {
  userId: string;
  initial: PendingApproval[];
  compact?: boolean;
  /** Keep resolved cards visible locally before refreshing server data. */
  resolvedHoldMs?: number;
  onApprovalResolved?: (outcome: ApprovalResolveResponse) => void;
}

export function LiveApprovals({
  userId,
  initial,
  compact,
  resolvedHoldMs = 0,
  onApprovalResolved,
}: LiveApprovalsProps) {
  const router = useRouter();
  const holdUntilRef = useRef(0);

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
      if (Date.now() < holdUntilRef.current) return;
      if (change.table === "approvals" || change.table === "action_intents") {
        router.refresh();
      }
    },
    [router],
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
          "flex flex-col items-center justify-center gap-3 rounded-[6px] border border-dashed border-line bg-surface text-center",
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
    <ul className={compact ? "space-y-3" : "space-y-4"}>
      {initial.map((item) => (
        <li key={item.approval.id}>
          <ApprovalCard item={item} onResolved={handleResolved} />
        </li>
      ))}
    </ul>
  );
}

"use client";

import { useCallback } from "react";
import { useRouter } from "next/navigation";
import type { PendingApproval } from "@/lib/data/types";
import { useLedgerRealtime, type LedgerChange } from "@/lib/realtime/use-ledger-realtime";
import { ApprovalCard } from "@/components/approvals/approval-card";

export interface LiveApprovalsProps {
  userId: string;
  initial: PendingApproval[];
  compact?: boolean;
}

export function LiveApprovals({ userId, initial, compact }: LiveApprovalsProps) {
  const router = useRouter();

  const onChange = useCallback(
    (change: LedgerChange) => {
      if (change.table === "approvals" || change.table === "action_intents") {
        router.refresh();
      }
    },
    [router],
  );

  useLedgerRealtime(userId, onChange);

  const handleResolved = useCallback(() => {
    router.refresh();
  }, [router]);

  if (initial.length === 0) {
    return (
      <p
        className={
          compact
            ? "rounded-md border border-dashed border-border px-3 py-6 text-center text-sm text-muted-foreground"
            : "rounded-lg border border-dashed border-border px-4 py-12 text-center text-sm text-muted-foreground"
        }
      >
        No actions awaiting your approval
      </p>
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

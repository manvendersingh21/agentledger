"use client";
import { useCallback } from "react";
import { useLedgerRealtime, type LedgerChange } from "@/lib/realtime/use-ledger-realtime";
import { useRefreshScheduler } from "@/lib/realtime/refresh-scheduler";

/** Drop into any server-rendered page: re-renders it when the user's ledger changes (debounced, page-wide coalesced). */
export function RealtimeRefresh({ userId, tables }: { userId: string; tables?: LedgerChange["table"][] }) {
  const { requestRealtimeRefresh } = useRefreshScheduler();
  const tableKey = tables?.join(",");
  const onChange = useCallback(
    (change: LedgerChange) => {
      if (tableKey !== undefined && !tableKey.split(",").includes(change.table)) return;
      requestRealtimeRefresh();
    },
    [requestRealtimeRefresh, tableKey],
  );
  useLedgerRealtime(userId, onChange);
  return null;
}

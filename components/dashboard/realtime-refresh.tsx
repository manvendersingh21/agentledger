"use client";
import { useRouter } from "next/navigation";
import { useCallback, useRef } from "react";
import { useLedgerRealtime, type LedgerChange } from "@/lib/realtime/use-ledger-realtime";

/** Drop into any server-rendered page: re-renders it when the user's ledger changes (debounced). */
export function RealtimeRefresh({ userId, tables }: { userId: string; tables?: LedgerChange["table"][] }) {
  const router = useRouter();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onChange = useCallback(
    (change: LedgerChange) => {
      if (tables && !tables.includes(change.table)) return;
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => router.refresh(), 150);
    },
    [router, tables],
  );
  useLedgerRealtime(userId, onChange);
  return null;
}

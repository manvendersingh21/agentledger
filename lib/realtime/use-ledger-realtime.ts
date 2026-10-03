"use client";
import { useEffect, useRef } from "react";
import { createClient } from "@/lib/supabase/client";

export interface LedgerChange {
  table: "action_intents" | "approvals" | "executions" | "receipts" | "audit_events";
  operation: "INSERT" | "UPDATE" | "DELETE";
  record: Record<string, unknown> | null;
  old_record: Record<string, unknown> | null;
}

/**
 * Subscribes to the signed-in user's private Broadcast topic `user:<uid>`. Postgres triggers publish
 * changes there; RLS on realtime.messages ensures nobody else can join this topic.
 */
export function useLedgerRealtime(userId: string, onChange: (change: LedgerChange) => void) {
  const handler = useRef(onChange);
  useEffect(() => {
    handler.current = onChange;
  }, [onChange]);

  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;
    let channel: ReturnType<typeof supabase.channel> | null = null;
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (data.session) await supabase.realtime.setAuth(data.session.access_token);
      if (cancelled) return;
      channel = supabase
        .channel(`user:${userId}`, { config: { private: true } })
        .on("broadcast", { event: "*" }, (msg) => {
          const p = (msg.payload ?? {}) as Record<string, unknown>;
          handler.current({
            table: p.table as LedgerChange["table"],
            operation: (p.operation ?? msg.event) as LedgerChange["operation"],
            record: (p.record as Record<string, unknown>) ?? null,
            old_record: (p.old_record as Record<string, unknown>) ?? null,
          });
        })
        .subscribe();
    })();
    return () => {
      cancelled = true;
      if (channel) supabase.removeChannel(channel);
    };
  }, [userId]);
}

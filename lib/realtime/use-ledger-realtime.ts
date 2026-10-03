"use client";
import { useEffect, useRef } from "react";
import { createClient } from "@/lib/supabase/client";

export interface LedgerChange {
  table: "action_intents" | "approvals" | "executions" | "receipts" | "audit_events" | "agents";
  operation: "INSERT" | "UPDATE" | "DELETE";
  record: Record<string, unknown> | null;
  old_record: Record<string, unknown> | null;
}

type Listener = (change: LedgerChange) => void;

interface Subscription {
  listeners: Set<Listener>;
  teardownTimer: ReturnType<typeof setTimeout> | null;
  close: () => void;
}

/** Keeps the channel alive across remounts (Strict Mode, keyed children, refresh-driven re-renders). */
const TEARDOWN_DELAY_MS = 2000;

// supabase-js returns the same channel object for a repeated topic, so every component on the page must
// share one subscription: a second `.subscribe()` throws and one `removeChannel` would cut off the rest.
const subscriptions = new Map<string, Subscription>();

function openSubscription(userId: string): Subscription {
  const supabase = createClient();
  const listeners = new Set<Listener>();
  let cancelled = false;
  let channel: ReturnType<typeof supabase.channel> | null = null;

  void (async () => {
    const { data } = await supabase.auth.getSession();
    if (data.session) await supabase.realtime.setAuth(data.session.access_token);
    if (cancelled) return;
    channel = supabase
      .channel(`user:${userId}`, { config: { private: true } })
      .on("broadcast", { event: "*" }, (msg) => {
        const p = (msg.payload ?? {}) as Record<string, unknown>;
        const change: LedgerChange = {
          table: p.table as LedgerChange["table"],
          operation: (p.operation ?? msg.event) as LedgerChange["operation"],
          record: (p.record as Record<string, unknown>) ?? null,
          old_record: (p.old_record as Record<string, unknown>) ?? null,
        };
        for (const listener of [...listeners]) listener(change);
      })
      .subscribe();
  })();

  return {
    listeners,
    teardownTimer: null,
    close: () => {
      cancelled = true;
      if (channel) void supabase.removeChannel(channel);
    },
  };
}

function addListener(userId: string, listener: Listener): () => void {
  let sub = subscriptions.get(userId);
  if (!sub) {
    sub = openSubscription(userId);
    subscriptions.set(userId, sub);
  }
  if (sub.teardownTimer) {
    clearTimeout(sub.teardownTimer);
    sub.teardownTimer = null;
  }
  sub.listeners.add(listener);
  const owned = sub;
  return () => {
    owned.listeners.delete(listener);
    if (owned.listeners.size > 0 || owned.teardownTimer) return;
    owned.teardownTimer = setTimeout(() => {
      owned.teardownTimer = null;
      if (owned.listeners.size > 0) return;
      owned.close();
      if (subscriptions.get(userId) === owned) subscriptions.delete(userId);
    }, TEARDOWN_DELAY_MS);
  };
}

/**
 * Subscribes to the signed-in user's private Broadcast topic `user:<uid>`. Postgres triggers publish
 * changes there; RLS on realtime.messages ensures nobody else can join this topic. All callers share a
 * single channel per user.
 */
export function useLedgerRealtime(userId: string, onChange: (change: LedgerChange) => void) {
  const handler = useRef(onChange);
  useEffect(() => {
    handler.current = onChange;
  }, [onChange]);

  useEffect(() => addListener(userId, (change) => handler.current(change)), [userId]);
}

"use client";

import Link from "next/link";
import { useCallback, useMemo, useState } from "react";
import { useLedgerRealtime } from "@/lib/realtime/use-ledger-realtime";
import type { AuditEventRow } from "@/lib/data/types";
import { LocalTime } from "@/components/local-time";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const EVENT_LABELS: Record<string, string> = {
  AGENT_AUTHENTICATED: "Agent authenticated",
  PRODUCT_SEARCHED: "Product search",
  UNTRUSTED_CONTENT_ENCOUNTERED: "Untrusted merchant content flagged",
  INTENT_PROPOSED: "Purchase proposed",
  PARAMETER_TAMPERING_DETECTED: "Parameter tampering detected",
  POLICY_EVALUATION_STARTED: "Policy evaluation started",
  POLICY_DENIED: "Policy denied action",
  POLICY_AUTO_APPROVED: "Policy auto-approved",
  POLICY_REQUIRES_APPROVAL: "Human approval required",
  HUMAN_APPROVAL_REQUESTED: "Approval requested",
  HUMAN_APPROVED: "Human approved",
  HUMAN_DENIED: "Human denied",
  EXECUTION_STARTED: "Execution started",
  PAYMENT_SUCCEEDED: "Payment succeeded",
  PAYMENT_FAILED: "Payment failed",
  RECEIPT_CREATED: "Receipt created",
  DUPLICATE_EXECUTION_BLOCKED: "Duplicate execution blocked",
  REPLAY_ATTEMPT_BLOCKED: "Replay attempt blocked",
  EVALUATION_FAILED_CLOSED: "Evaluation failed closed",
  DELEGATION_UPDATED: "Delegation updated",
  DEMO_RESET: "Demo reset",
};

function eventVariant(eventType: string): "neutral" | "red" | "amber" | "emerald" | "sky" | "violet" {
  if (
    eventType.includes("DENIED") ||
    eventType.includes("BLOCKED") ||
    eventType === "PAYMENT_FAILED" ||
    eventType === "EVALUATION_FAILED_CLOSED" ||
    eventType === "PARAMETER_TAMPERING_DETECTED"
  ) {
    return "red";
  }
  if (eventType.includes("APPROVAL") && !eventType.includes("AUTO")) return "amber";
  if (eventType === "DUPLICATE_EXECUTION_BLOCKED" || eventType === "REPLAY_ATTEMPT_BLOCKED") {
    return "violet";
  }
  if (eventType.includes("EXECUT") || eventType === "PAYMENT_SUCCEEDED" || eventType === "RECEIPT_CREATED") {
    return "emerald";
  }
  if (eventType.includes("AUTO_APPROVED") || eventType === "HUMAN_APPROVED") return "sky";
  return "neutral";
}

function friendlyLabel(event: AuditEventRow): string {
  const base = EVENT_LABELS[event.event_type] ?? event.event_type.replaceAll("_", " ").toLowerCase();
  const data = event.event_data;
  const product = typeof data.product_name === "string" ? data.product_name : null;
  const merchant = typeof data.merchant_name === "string" ? data.merchant_name : null;
  if (product) return `${base}: ${product}`;
  if (merchant) return `${base}: ${merchant}`;
  return base;
}

function rowFromRecord(record: Record<string, unknown>): AuditEventRow | null {
  const id = typeof record.id === "string" ? record.id : null;
  if (!id) return null;
  return {
    id,
    principal_id: String(record.principal_id ?? ""),
    agent_id: record.agent_id != null ? String(record.agent_id) : null,
    intent_id: record.intent_id != null ? String(record.intent_id) : null,
    event_type: String(record.event_type ?? ""),
    event_data: (record.event_data as Record<string, unknown>) ?? {},
    previous_hash: String(record.previous_hash ?? ""),
    event_hash: String(record.event_hash ?? ""),
    created_at: String(record.created_at ?? new Date().toISOString()),
  };
}

export interface ActivityStreamProps {
  userId: string;
  initialEvents: AuditEventRow[];
}

export function ActivityStream({ userId, initialEvents }: ActivityStreamProps) {
  const [events, setEvents] = useState<AuditEventRow[]>(initialEvents);

  const onChange = useCallback(
    (change: { table: string; operation: string; record: Record<string, unknown> | null }) => {
      if (change.table !== "audit_events" || change.operation !== "INSERT" || !change.record) {
        return;
      }
      const row = rowFromRecord(change.record);
      if (!row) return;
      setEvents((prev) => {
        if (prev.some((e) => e.id === row.id)) return prev;
        return [row, ...prev].slice(0, 50);
      });
    },
    [],
  );

  useLedgerRealtime(userId, onChange);

  const empty = events.length === 0;

  const sorted = useMemo(
    () => [...events].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()),
    [events],
  );

  return (
    <div className="rounded-md border border-line bg-surface">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-line px-5 py-5 md:px-6">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-accent">Audit</p>
          <h2 className="mt-2 font-display text-[28px] font-semibold leading-[0.95] tracking-[-0.045em] text-ink md:text-[32px]">
            Live activity
          </h2>
          <p className="mt-2 text-[13px] text-ink-3">Tamper-evident audit chain — newest first</p>
        </div>
        <div className="flex items-center gap-2 rounded-sm bg-executed-bg px-2 py-1 text-[11px] font-semibold uppercase tracking-[0.1em] text-executed">
          <span className="relative flex size-2">
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-executed opacity-40 motion-reduce:animate-none" />
            <span className="relative inline-flex size-2 rounded-full bg-executed" />
          </span>
          Live
        </div>
      </div>
      {empty ? (
        <p className="px-6 py-14 text-center text-[15px] text-ink-3">
          No audit events yet. Run the Playground or Attack Lab to see activity.
        </p>
      ) : (
        <ul className="divide-y divide-line">
          {sorted.map((event) => (
            <li
              key={event.id}
              className="flex gap-4 px-5 py-4 text-[15px] transition-colors hover:bg-canvas/50 md:px-6"
            >
              <LocalTime
                iso={event.created_at}
                className="w-20 shrink-0 pt-0.5 font-mono text-[12px] tabular-nums text-ink-3"
              />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                  <Badge variant={eventVariant(event.event_type)} className="shrink-0">
                    {event.event_type.replaceAll("_", " ")}
                  </Badge>
                  <span className="min-w-0 text-ink">{friendlyLabel(event)}</span>
                </div>
                {event.intent_id ? (
                  <Link
                    href={`/dashboard/transactions/${event.intent_id}`}
                    className="mt-1.5 inline-block font-mono text-[12px] text-accent hover:text-accent-hover hover:underline"
                  >
                    {event.intent_id.slice(0, 8)}…
                  </Link>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
      <div
        className={cn(
          "border-t border-line px-5 py-3 text-[12px] text-ink-3 md:px-6",
          "flex items-center gap-2",
        )}
      >
        <span className="relative flex size-2">
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-accent opacity-40 motion-reduce:animate-none" />
          <span className="relative inline-flex size-2 rounded-full bg-accent" />
        </span>
        Listening for new events
      </div>
    </div>
  );
}

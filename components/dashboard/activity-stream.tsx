"use client";

import Link from "next/link";
import { useCallback, useMemo, useState } from "react";
import { useLedgerRealtime } from "@/lib/realtime/use-ledger-realtime";
import type { AuditEventRow } from "@/lib/data/types";
import { formatTime } from "@/lib/utils";
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
    <div className="rounded-lg border border-border bg-card">
      <div className="border-b border-border px-4 py-3">
        <h2 className="text-sm font-semibold">Live activity</h2>
        <p className="text-xs text-muted-foreground">Tamper-evident audit chain — newest first</p>
      </div>
      {empty ? (
        <p className="px-4 py-8 text-center text-sm text-muted-foreground">
          No audit events yet. Run the Playground or Attack Lab to see activity.
        </p>
      ) : (
        <ul className="divide-y divide-border">
          {sorted.map((event) => (
            <li key={event.id} className="flex gap-3 px-4 py-3 text-sm">
              <time
                className="shrink-0 font-mono text-xs text-muted-foreground tabular-nums"
                dateTime={event.created_at}
              >
                {formatTime(event.created_at)}
              </time>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={eventVariant(event.event_type)} className="shrink-0">
                    {event.event_type.replaceAll("_", " ")}
                  </Badge>
                  <span className="text-foreground/90">{friendlyLabel(event)}</span>
                </div>
                {event.intent_id ? (
                  <Link
                    href={`/dashboard/transactions/${event.intent_id}`}
                    className="mt-1 inline-block font-mono text-xs text-sky-400 hover:underline"
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
          "border-t border-border px-4 py-2 text-xs text-muted-foreground",
          "flex items-center gap-2",
        )}
      >
        <span className="relative flex size-2">
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-40" />
          <span className="relative inline-flex size-2 rounded-full bg-emerald-500" />
        </span>
        Listening for new events
      </div>
    </div>
  );
}

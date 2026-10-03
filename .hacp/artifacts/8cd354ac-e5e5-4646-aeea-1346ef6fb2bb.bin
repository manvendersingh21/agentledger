// Append-only, hash-chained audit log (per principal). Runtime-agnostic (Node + Deno).
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  GENESIS_HASH,
  computeEventHash,
  verifyAuditChain,
  type AuditEventRecord,
} from "../crypto/audit-chain.ts";

export type AuditEventType =
  | "DELEGATION_CREATED"
  | "DELEGATION_UPDATED"
  | "AGENT_AUTHENTICATED"
  | "PRODUCT_SEARCHED"
  | "UNTRUSTED_CONTENT_ENCOUNTERED"
  | "INTENT_PROPOSED"
  | "PARAMETER_TAMPERING_DETECTED"
  | "POLICY_EVALUATION_STARTED"
  | "POLICY_DENIED"
  | "POLICY_AUTO_APPROVED"
  | "POLICY_REQUIRES_APPROVAL"
  | "HUMAN_APPROVAL_REQUESTED"
  | "HUMAN_APPROVED"
  | "HUMAN_DENIED"
  | "EXECUTION_STARTED"
  | "PAYMENT_SUCCEEDED"
  | "PAYMENT_FAILED"
  | "RECEIPT_CREATED"
  | "DUPLICATE_EXECUTION_BLOCKED"
  | "REPLAY_ATTEMPT_BLOCKED"
  | "EVALUATION_FAILED_CLOSED"
  | "DEMO_RESET";

export interface AppendAuditInput {
  principalId: string;
  agentId?: string | null;
  intentId?: string | null;
  eventType: AuditEventType;
  eventData?: Record<string, unknown>;
}

interface AuditRow {
  id: string;
  principal_id: string;
  agent_id: string | null;
  intent_id: string | null;
  event_type: string;
  event_data: unknown;
  previous_hash: string;
  event_hash: string;
  created_at: string;
}

export function rowToAuditRecord(row: AuditRow): AuditEventRecord {
  return {
    id: row.id,
    principalId: row.principal_id,
    agentId: row.agent_id,
    intentId: row.intent_id,
    eventType: row.event_type,
    eventData: row.event_data,
    previousHash: row.previous_hash,
    eventHash: row.event_hash,
    createdAt: new Date(row.created_at).toISOString(),
  };
}

/**
 * Appends one event to the principal's chain. `unique(principal_id, previous_hash)` in the DB
 * rejects forks, so concurrent writers retry against the new tip instead of branching the chain.
 */
export async function appendAuditEvent(db: SupabaseClient, input: AppendAuditInput): Promise<AuditEventRecord> {
  for (let attempt = 0; attempt < 8; attempt++) {
    const { data: tipRows, error: tipError } = await db
      .from("audit_events")
      .select("event_hash, created_at")
      .eq("principal_id", input.principalId)
      .order("created_at", { ascending: false })
      .limit(1);
    if (tipError) throw new Error(`audit tip lookup failed: ${tipError.message}`);

    const tip = tipRows?.[0] as { event_hash: string; created_at: string } | undefined;
    const previousHash = tip?.event_hash ?? GENESIS_HASH;
    // Strictly increasing timestamps keep display order equal to chain order.
    const nowMs = Date.now();
    const tipMs = tip ? new Date(tip.created_at).getTime() : 0;
    const createdAt = new Date(Math.max(nowMs, tipMs + 1)).toISOString();

    const base = {
      id: crypto.randomUUID(),
      principalId: input.principalId,
      agentId: input.agentId ?? null,
      intentId: input.intentId ?? null,
      eventType: input.eventType,
      eventData: input.eventData ?? {},
      createdAt,
    };
    const eventHash = await computeEventHash(previousHash, base);

    const { error } = await db.from("audit_events").insert({
      id: base.id,
      principal_id: base.principalId,
      agent_id: base.agentId,
      intent_id: base.intentId,
      event_type: base.eventType,
      event_data: base.eventData,
      previous_hash: previousHash,
      event_hash: eventHash,
      created_at: createdAt,
    });
    if (!error) return { ...base, previousHash, eventHash };
    if (error.code !== "23505") throw new Error(`audit append failed: ${error.message}`);
    // Lost a race for this tip; retry on the new tip.
  }
  throw new Error("audit append failed: could not acquire chain tip");
}

export async function loadAuditEvents(
  db: SupabaseClient,
  principalId: string,
  options: { intentId?: string } = {},
): Promise<AuditEventRecord[]> {
  let query = db.from("audit_events").select("*").eq("principal_id", principalId);
  if (options.intentId) query = query.eq("intent_id", options.intentId);
  const { data, error } = await query.order("created_at", { ascending: true }).limit(5000);
  if (error) throw new Error(`audit load failed: ${error.message}`);
  return (data as AuditRow[]).map(rowToAuditRecord);
}

/** Verifies the principal's entire chain (a per-intent slice is not independently verifiable). */
export async function verifyPrincipalChain(db: SupabaseClient, principalId: string) {
  const events = await loadAuditEvents(db, principalId);
  return verifyAuditChain(events);
}

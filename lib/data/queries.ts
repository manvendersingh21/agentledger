import "server-only";
import { createClient } from "@/lib/supabase/server";
import { getDomainContext } from "@/lib/domain/server-context";
import { verifyPrincipalChain } from "@/lib/domain/audit";
import type {
  AgentRow, ApprovalRow, AuditEventRow, AuditVerification, DelegationRow, ExecutionRow, IntentRow,
  MerchantRow, Metrics, PendingApproval, PolicyDecisionRow, ReceiptRow,
} from "./types";

/**
 * Dashboard reads. All go through the user's RLS-scoped client, so a user can only ever see their own rows.
 * `ensureSetup()` provisions the default agent + delegation on first visit.
 */
export async function ensureSetup() {
  const session = await getDomainContext("dashboard");
  if (!session) throw new Error("not signed in");
  return { principal: session.principal, agentId: session.ctx.agentId, paymentProviderLabel: session.ctx.payments.label };
}

export async function getAgents(): Promise<AgentRow[]> {
  const db = await createClient();
  const { data } = await db.from("agents").select("*").order("created_at");
  return (data ?? []) as AgentRow[];
}

export async function getDelegation(): Promise<DelegationRow | null> {
  const db = await createClient();
  const { data } = await db.from("delegations").select("*").order("created_at", { ascending: false }).limit(1);
  return ((data ?? [])[0] as DelegationRow | undefined) ?? null;
}

export async function getMerchants(): Promise<MerchantRow[]> {
  const db = await createClient();
  const { data } = await db
    .from("merchants")
    .select("id, slug, name, trusted, domain, trust_score, trust_score_source, verified")
    .order("name");
  return (data ?? []) as MerchantRow[];
}

export async function getIntents(limit = 100): Promise<(IntentRow & { decision: PolicyDecisionRow | null })[]> {
  const db = await createClient();
  const { data: intents } = await db.from("action_intents").select("*").order("created_at", { ascending: false }).limit(limit);
  const rows = (intents ?? []) as IntentRow[];
  if (rows.length === 0) return [];
  const { data: decisions } = await db
    .from("policy_decisions")
    .select("*")
    .in("intent_id", rows.map((r) => r.id))
    .order("created_at", { ascending: true });
  const byIntent = new Map<string, PolicyDecisionRow>();
  for (const d of (decisions ?? []) as PolicyDecisionRow[]) byIntent.set(d.intent_id, d);
  return rows.map((r) => ({ ...r, decision: byIntent.get(r.id) ?? null }));
}

export interface IntentDetail {
  intent: IntentRow;
  decisions: PolicyDecisionRow[];
  approval: ApprovalRow | null;
  execution: ExecutionRow | null;
  receipt: ReceiptRow | null;
  events: AuditEventRow[];
  agent: AgentRow | null;
  delegation: DelegationRow | null;
}

export async function getIntentDetail(intentId: string): Promise<IntentDetail | null> {
  const db = await createClient();
  const { data: intent } = await db.from("action_intents").select("*").eq("id", intentId).maybeSingle();
  if (!intent) return null;
  const i = intent as IntentRow;
  const [decisions, approval, execution, receipt, events, agent, delegation] = await Promise.all([
    db.from("policy_decisions").select("*").eq("intent_id", intentId).order("created_at"),
    db.from("approvals").select("*").eq("intent_id", intentId).maybeSingle(),
    db.from("executions").select("*").eq("intent_id", intentId).maybeSingle(),
    db.from("receipts").select("*").eq("intent_id", intentId).maybeSingle(),
    db.from("audit_events").select("*").eq("intent_id", intentId).order("created_at"),
    db.from("agents").select("*").eq("id", i.agent_id).maybeSingle(),
    i.delegation_id ? db.from("delegations").select("*").eq("id", i.delegation_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  return {
    intent: i,
    decisions: (decisions.data ?? []) as PolicyDecisionRow[],
    approval: (approval.data as ApprovalRow | null) ?? null,
    execution: (execution.data as ExecutionRow | null) ?? null,
    receipt: (receipt.data as ReceiptRow | null) ?? null,
    events: (events.data ?? []) as AuditEventRow[],
    agent: (agent.data as AgentRow | null) ?? null,
    delegation: (delegation.data as DelegationRow | null) ?? null,
  };
}

/** Context events (not tied to an intent) that happened shortly before it — searches, untrusted content, auth. */
export async function getContextEvents(beforeIso: string, windowMinutes = 10): Promise<AuditEventRow[]> {
  const db = await createClient();
  const from = new Date(new Date(beforeIso).getTime() - windowMinutes * 60_000).toISOString();
  const { data } = await db
    .from("audit_events")
    .select("*")
    .is("intent_id", null)
    .gte("created_at", from)
    .lte("created_at", beforeIso)
    .order("created_at");
  return (data ?? []) as AuditEventRow[];
}

export async function getPendingApprovals(): Promise<PendingApproval[]> {
  const db = await createClient();
  const { data: approvals } = await db.from("approvals").select("*").eq("status", "pending").order("requested_at", { ascending: false });
  const list = (approvals ?? []) as ApprovalRow[];
  if (list.length === 0) return [];
  const ids = list.map((a) => a.intent_id);
  const [{ data: intents }, { data: decisions }, { data: agents }, delegation] = await Promise.all([
    db.from("action_intents").select("*").in("id", ids),
    db.from("policy_decisions").select("*").in("intent_id", ids),
    db.from("agents").select("id, name"),
    getDelegation(),
  ]);
  return list.flatMap((approval) => {
    const intent = ((intents ?? []) as IntentRow[]).find((i) => i.id === approval.intent_id);
    if (!intent) return [];
    const decision = ((decisions ?? []) as PolicyDecisionRow[]).filter((d) => d.intent_id === intent.id).at(-1) ?? null;
    const agentName = ((agents ?? []) as { id: string; name: string }[]).find((a) => a.id === intent.agent_id)?.name ?? "Agent";
    return [{ approval, intent, decision, agentName, delegation }];
  });
}

export async function getAuditEvents(limit = 300): Promise<AuditEventRow[]> {
  const db = await createClient();
  const { data } = await db.from("audit_events").select("*").order("created_at", { ascending: false }).limit(limit);
  return (data ?? []) as AuditEventRow[];
}

export async function getAuditVerification(): Promise<AuditVerification> {
  const session = await getDomainContext("dashboard");
  if (!session) return { valid: false, verifiedCount: 0, reason: "not signed in" };
  return verifyPrincipalChain(session.ctx.db, session.ctx.principalId);
}

export async function getMetrics(): Promise<Metrics> {
  const db = await createClient();
  const [{ data: intents }, { count: approvals }, { count: dupes }] = await Promise.all([
    db.from("action_intents").select("status, amount_cents"),
    db.from("approvals").select("id", { count: "exact", head: true }),
    db.from("audit_events").select("id", { count: "exact", head: true }).eq("event_type", "DUPLICATE_EXECUTION_BLOCKED"),
  ]);
  const rows = (intents ?? []) as { status: string; amount_cents: number }[];
  const blocked = rows.filter((r) => r.status === "denied");
  const executed = rows.filter((r) => r.status === "executed");
  return {
    evaluated: rows.filter((r) => r.status !== "proposed").length,
    blocked: blocked.length,
    humanApprovals: approvals ?? 0,
    executed: executed.length,
    spendProtectedCents: blocked.reduce((s, r) => s + r.amount_cents, 0),
    spentCents: executed.reduce((s, r) => s + r.amount_cents, 0),
    duplicatesBlocked: dupes ?? 0,
  };
}

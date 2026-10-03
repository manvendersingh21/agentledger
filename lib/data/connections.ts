import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { AuditEventRow } from "./types";
import {
  aggregateMcpSessions,
  isMcpConnectionEvent,
  type McpConnectionData,
} from "./mcp-sessions";

export type { McpConnectionSession, McpConnectionData } from "./mcp-sessions";
export { MCP_LIVE_THRESHOLD_MS } from "./mcp-sessions";

/** RLS-scoped read of MCP channel activity for the signed-in principal. */
export async function getMcpConnectionData(): Promise<McpConnectionData> {
  const db = await createClient();
  const { data } = await db
    .from("audit_events")
    .select("*")
    .in("event_type", ["AGENT_AUTHENTICATED", "PRODUCT_SEARCHED", "INTENT_PROPOSED"])
    .order("created_at", { ascending: false })
    .limit(400);

  const rows = (data ?? []) as AuditEventRow[];
  const events = rows.filter(isMcpConnectionEvent);

  const agentIds = new Set<string>();
  for (const event of events) {
    if (event.agent_id) agentIds.add(event.agent_id);
  }

  const agentNames: Record<string, string> = {};
  if (agentIds.size > 0) {
    const { data: agents } = await db
      .from("agents")
      .select("id, name")
      .in("id", [...agentIds]);
    for (const agent of agents ?? []) {
      agentNames[agent.id] = agent.name;
    }
  }

  const sessions = aggregateMcpSessions(events, agentNames);
  return { sessions, events, agentNames };
}

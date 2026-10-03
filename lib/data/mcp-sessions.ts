import type { AuditEventRow } from "./types";

export const MCP_LIVE_THRESHOLD_MS = 2 * 60 * 1000;

export interface McpConnectionData {
  sessions: McpConnectionSession[];
  events: AuditEventRow[];
  agentNames: Record<string, string>;
}

export interface McpConnectionSession {
  sessionId: string;
  agentId: string | null;
  agentName: string;
  authenticatedAt: string;
  lastSeenAt: string;
  toolCallCount: number;
  live: boolean;
}

function mcpChannel(event: AuditEventRow): boolean {
  const channel = event.event_data.channel;
  return channel === "mcp";
}

export function isMcpConnectionEvent(event: AuditEventRow): boolean {
  if (!mcpChannel(event)) return false;
  return (
    event.event_type === "AGENT_AUTHENTICATED" ||
    event.event_type === "PRODUCT_SEARCHED" ||
    event.event_type === "INTENT_PROPOSED"
  );
}

export function aggregateMcpSessions(
  events: AuditEventRow[],
  agentNames: Record<string, string>,
  now = new Date(),
): McpConnectionSession[] {
  const sorted = [...events]
    .filter(isMcpConnectionEvent)
    .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

  const sessions: McpConnectionSession[] = [];
  let current: { auth: AuditEventRow; toolCallCount: number; lastSeenAt: string } | null = null;

  for (const event of sorted) {
    if (event.event_type === "AGENT_AUTHENTICATED") {
      if (current) {
        sessions.push(buildSession(current, agentNames, now));
      }
      current = { auth: event, toolCallCount: 0, lastSeenAt: event.created_at };
      continue;
    }
    if (!current) continue;
    if (event.event_type === "PRODUCT_SEARCHED" || event.event_type === "INTENT_PROPOSED") {
      current.toolCallCount += 1;
      current.lastSeenAt = event.created_at;
    }
  }
  if (current) {
    sessions.push(buildSession(current, agentNames, now));
  }

  return sessions.sort(
    (a, b) => new Date(b.lastSeenAt).getTime() - new Date(a.lastSeenAt).getTime(),
  );
}

function buildSession(
  current: { auth: AuditEventRow; toolCallCount: number; lastSeenAt: string },
  agentNames: Record<string, string>,
  now: Date,
): McpConnectionSession {
  const agentId = current.auth.agent_id;
  const agentName =
    (agentId && agentNames[agentId]) ||
    (typeof current.auth.event_data.principal_email === "string"
      ? current.auth.event_data.principal_email
      : "MCP agent");
  const lastMs = new Date(current.lastSeenAt).getTime();
  return {
    sessionId: current.auth.id,
    agentId,
    agentName,
    authenticatedAt: current.auth.created_at,
    lastSeenAt: current.lastSeenAt,
    toolCallCount: current.toolCallCount,
    live: now.getTime() - lastMs <= MCP_LIVE_THRESHOLD_MS,
  };
}

export function mergeMcpAuditEvent(
  events: AuditEventRow[],
  incoming: AuditEventRow,
): AuditEventRow[] {
  if (!isMcpConnectionEvent(incoming)) return events;
  if (events.some((e) => e.id === incoming.id)) return events;
  return [...events, incoming].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  );
}

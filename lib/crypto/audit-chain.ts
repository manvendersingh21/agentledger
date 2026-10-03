export const GENESIS_HASH = "0".repeat(64);

export interface AuditEventRecord {
  id: string;
  principalId: string;
  agentId: string | null;
  intentId: string | null;
  eventType: string;
  eventData: unknown;
  previousHash: string;
  eventHash: string;
  createdAt: string;
}

type EventPayload = Omit<AuditEventRecord, "previousHash" | "eventHash">;

/** JSON semantics, with every object's keys ordered lexicographically. */
export function canonicalJson(value: unknown): string {
  // Normalize once so undefined object fields, sparse arrays and toJSON follow JSON.
  const serialized = JSON.stringify(value);
  if (serialized === undefined) throw new TypeError("Value is not JSON serializable");

  function encode(item: unknown): string {
    if (item === null || typeof item !== "object") return JSON.stringify(item);
    if (Array.isArray(item)) return `[${item.map(encode).join(",")}]`;
    const record = item as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${encode(record[key])}`).join(",")}}`;
  }

  return encode(JSON.parse(serialized) as unknown);
}

export async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function canonicalEventPayload(e: EventPayload): string {
  return canonicalJson({
    id: e.id,
    event_type: e.eventType,
    principal_id: e.principalId,
    agent_id: e.agentId,
    intent_id: e.intentId,
    event_data: e.eventData,
    created_at: new Date(e.createdAt).toISOString(),
  });
}

export function computeEventHash(previousHash: string, e: EventPayload): Promise<string> {
  return sha256Hex(previousHash + canonicalEventPayload(e));
}

export async function verifyAuditChain(events: AuditEventRecord[]): Promise<{
  valid: boolean;
  verifiedCount: number;
  brokenAt?: string;
  reason?: string;
}> {
  if (events.length === 0) return { valid: true, verifiedCount: 0 };

  const successors = new Map<string, AuditEventRecord>();
  const eventIds = new Set<string>();
  const hashes = new Set<string>();
  for (const event of events) {
    if (successors.has(event.previousHash)) {
      return { valid: false, verifiedCount: 0, brokenAt: event.id, reason: "Audit chain forks at a previous hash" };
    }
    if (eventIds.has(event.id) || hashes.has(event.eventHash)) {
      return { valid: false, verifiedCount: 0, brokenAt: event.id, reason: "Duplicate audit event" };
    }
    successors.set(event.previousHash, event);
    eventIds.add(event.id);
    hashes.add(event.eventHash);
  }

  let previousHash = GENESIS_HASH;
  let principalId: string | undefined;
  let verifiedCount = 0;
  const visited = new Set<string>();
  while (verifiedCount < events.length) {
    const event = successors.get(previousHash);
    if (!event || visited.has(event.id)) {
      const orphan = events.find((candidate) => !visited.has(candidate.id));
      return { valid: false, verifiedCount, brokenAt: orphan?.id, reason: "Missing chain link or genesis event" };
    }
    if (principalId !== undefined && event.principalId !== principalId) {
      return { valid: false, verifiedCount, brokenAt: event.id, reason: "Principal changed within audit chain" };
    }
    try {
      if (event.eventHash !== await computeEventHash(previousHash, event)) {
        return { valid: false, verifiedCount, brokenAt: event.id, reason: "Event hash mismatch" };
      }
    } catch {
      return { valid: false, verifiedCount, brokenAt: event.id, reason: "Invalid event payload" };
    }
    principalId = event.principalId;
    previousHash = event.eventHash;
    visited.add(event.id);
    verifiedCount += 1;
  }
  return { valid: true, verifiedCount };
}

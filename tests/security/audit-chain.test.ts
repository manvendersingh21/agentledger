import { describe, expect, it } from "vitest";
import { canonicalEventPayload, canonicalJson, computeEventHash, GENESIS_HASH, sha256Hex, verifyAuditChain, type AuditEventRecord } from "../../lib/crypto/audit-chain.ts";

async function event(id: string, previousHash = GENESIS_HASH, changes: Partial<AuditEventRecord> = {}): Promise<AuditEventRecord> {
  const record: AuditEventRecord = {
    id, principalId: "principal", agentId: "agent", intentId: null, eventType: "intent.proposed",
    eventData: { amount_cents: 1500, merchant: "acme-api" }, previousHash, eventHash: "",
    createdAt: "2026-10-03T12:00:00.000Z", ...changes,
  };
  record.eventHash = await computeEventHash(record.previousHash, record);
  return record;
}

describe("audit canonicalization and integrity", () => {
  it("orders all keys lexicographically, including numeric-looking keys, and omits undefined", () => {
    expect(canonicalJson({ z: undefined, b: [undefined, { z: 1, a: "é" }], a: { "2": 2, "10": 10 } }))
      .toBe('{"a":{"10":10,"2":2},"b":[null,{"a":"é","z":1}]}');
    expect(canonicalJson({ b: 2, a: 1 })).toBe(canonicalJson({ a: 1, b: 2 }));
    expect(() => canonicalJson(undefined)).toThrow(TypeError);
    const cyclic: Record<string, unknown> = {}; cyclic.self = cyclic;
    expect(() => canonicalJson(cyclic)).toThrow(TypeError);
  });

  it("matches the SHA-256 standard test vector", async () => {
    expect(await sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });

  it("uses snake_case event keys and normalized timestamps", async () => {
    const record = await event("first");
    const equivalent = { ...record, createdAt: "2026-10-03T05:00:00-07:00" };
    expect(canonicalEventPayload(equivalent)).toBe(canonicalEventPayload(record));
    expect(JSON.parse(canonicalEventPayload(record))).toEqual({ id: "first", principal_id: "principal", agent_id: "agent", intent_id: null,
      event_type: "intent.proposed", event_data: { amount_cents: 1500, merchant: "acme-api" }, created_at: "2026-10-03T12:00:00.000Z" });
    expect(await computeEventHash(GENESIS_HASH, record)).toBe(await sha256Hex(GENESIS_HASH + canonicalEventPayload(record)));
  });

  it("follows hash links even for unordered events and backward timestamps", async () => {
    const a = await event("a");
    const b = await event("b", a.eventHash, { createdAt: "2026-10-02T00:00:00Z" });
    const c = await event("c", b.eventHash);
    expect(await verifyAuditChain([c, a, b])).toEqual({ valid: true, verifiedCount: 3 });
    expect(await verifyAuditChain([])).toEqual({ valid: true, verifiedCount: 0 });
  });

  it("detects tampering, missing events, forks, duplicates and invalid payloads", async () => {
    const a = await event("a");
    const b = await event("b", a.eventHash);
    const c = await event("c", b.eventHash);
    expect(await verifyAuditChain([a, { ...b, eventData: { amount_cents: 5 } }, c])).toMatchObject({ valid: false, verifiedCount: 1, brokenAt: "b" });
    expect(await verifyAuditChain([a, c])).toMatchObject({ valid: false, verifiedCount: 1, brokenAt: "c" });
    expect(await verifyAuditChain([b, c])).toMatchObject({ valid: false, verifiedCount: 0 });
    expect(await verifyAuditChain([a, b, await event("fork", a.eventHash)])).toMatchObject({ valid: false });
    expect(await verifyAuditChain([a, a])).toMatchObject({ valid: false });
    expect(await verifyAuditChain([{ ...a, createdAt: "invalid" }])).toMatchObject({ valid: false, brokenAt: "a" });
    expect(await verifyAuditChain([a, { ...b, eventHash: "f".repeat(64) }])).toMatchObject({ valid: false, brokenAt: "b" });
  });

  it("rejects a principal change even when every hash is mathematically valid", async () => {
    const a = await event("a");
    const b = await event("b", a.eventHash, { principalId: "someone-else" });
    expect(await verifyAuditChain([a, b])).toMatchObject({ valid: false, verifiedCount: 1, brokenAt: "b", reason: "Principal changed within audit chain" });
  });
});

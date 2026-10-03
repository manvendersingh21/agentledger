import { describe, expect, it } from "vitest";
import { assertTransition, canTransition, InvalidTransitionError, TRANSITIONS, type IntentStatus } from "../../lib/ledger/state-machine.ts";

const statuses: IntentStatus[] = ["proposed", "evaluating", "denied", "awaiting_approval", "approved", "executing", "executed", "failed", "expired", "duplicate"];
const permitted = new Set([
  "proposed:evaluating", "evaluating:denied", "evaluating:awaiting_approval", "evaluating:approved",
  "awaiting_approval:approved", "awaiting_approval:denied", "awaiting_approval:expired",
  "approved:executing", "approved:denied", "executing:executed", "executing:failed",
]);

describe("intent state machine", () => {
  it("enforces the complete transition matrix and permits same-state no-ops", () => {
    for (const from of statuses) {
      for (const to of statuses) {
        const allowed = from === to || permitted.has(`${from}:${to}`);
        expect(canTransition(from, to), `${from} -> ${to}`).toBe(allowed);
        if (allowed) expect(() => assertTransition(from, to)).not.toThrow();
        else expect(() => assertTransition(from, to)).toThrow(InvalidTransitionError);
      }
    }
  });

  it("preserves from/to in errors for diagnostics", () => {
    try {
      assertTransition("proposed", "executed");
      expect.unreachable();
    } catch (error) {
      expect(error).toMatchObject({ name: "InvalidTransitionError", from: "proposed", to: "executed", message: "INVALID_STATE_TRANSITION proposed -> executed" });
    }
  });

  it("rejects unknown and inherited object keys and prevents accidental table mutation", () => {
    expect(canTransition("constructor" as IntentStatus, "constructor" as IntentStatus)).toBe(false);
    expect(canTransition("unknown" as IntentStatus, "approved")).toBe(false);
    expect(Object.isFrozen(TRANSITIONS)).toBe(true);
    expect(Object.isFrozen(TRANSITIONS.proposed)).toBe(true);
  });
});

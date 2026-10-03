export type IntentStatus =
  | "proposed"
  | "evaluating"
  | "denied"
  | "awaiting_approval"
  | "approved"
  | "executing"
  | "executed"
  | "failed"
  | "expired"
  | "duplicate";

export const TRANSITIONS: Record<IntentStatus, readonly IntentStatus[]> = Object.freeze({
  proposed: Object.freeze(["evaluating"] as const),
  evaluating: Object.freeze(["denied", "awaiting_approval", "approved"] as const),
  denied: Object.freeze([]),
  awaiting_approval: Object.freeze(["approved", "denied", "expired"] as const),
  approved: Object.freeze(["executing", "denied"] as const),
  executing: Object.freeze(["executed", "failed"] as const),
  executed: Object.freeze([]),
  failed: Object.freeze([]),
  expired: Object.freeze([]),
  duplicate: Object.freeze([]),
});

export class InvalidTransitionError extends Error {
  readonly from: IntentStatus;
  readonly to: IntentStatus;

  constructor(from: IntentStatus, to: IntentStatus) {
    super(`INVALID_STATE_TRANSITION ${from} -> ${to}`);
    this.name = "InvalidTransitionError";
    this.from = from;
    this.to = to;
  }
}

export function canTransition(from: IntentStatus, to: IntentStatus): boolean {
  if (!Object.hasOwn(TRANSITIONS, from) || !Object.hasOwn(TRANSITIONS, to)) return false;
  return from === to || TRANSITIONS[from].includes(to);
}

export function assertTransition(from: IntentStatus, to: IntentStatus): void {
  if (!canTransition(from, to)) throw new InvalidTransitionError(from, to);
}

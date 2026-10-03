import { Badge } from "@/components/ui/badge";
import type { IntentStatus } from "@/lib/ledger/state-machine";
import { cn } from "@/lib/utils";

const STATUS_CONFIG: Record<
  IntentStatus,
  { label: string; variant: "neutral" | "red" | "amber" | "emerald" | "sky" | "violet"; pulse?: boolean }
> = {
  denied: { label: "BLOCKED", variant: "red" },
  awaiting_approval: { label: "WAITING", variant: "amber" },
  approved: { label: "APPROVED", variant: "sky" },
  executing: { label: "EXECUTING", variant: "sky", pulse: true },
  executed: { label: "EXECUTED", variant: "emerald" },
  failed: { label: "FAILED", variant: "red" },
  duplicate: { label: "DUPLICATE", variant: "violet" },
  proposed: { label: "EVALUATING", variant: "neutral" },
  evaluating: { label: "EVALUATING", variant: "neutral" },
  expired: { label: "EXPIRED", variant: "neutral" },
};

export function StatusBadge({ status }: { status: IntentStatus }) {
  const config = STATUS_CONFIG[status];
  return (
    <Badge
      variant={config.variant}
      className={cn(config.pulse && "animate-pulse")}
    >
      {config.label}
    </Badge>
  );
}

type PolicyDecision = "deny" | "auto_approve" | "require_approval";

const DECISION_CONFIG: Record<
  PolicyDecision,
  { label: string; variant: "neutral" | "red" | "amber" | "emerald" | "sky" | "violet" }
> = {
  deny: { label: "DENY", variant: "red" },
  auto_approve: { label: "AUTO-APPROVE", variant: "emerald" },
  require_approval: { label: "REQUIRE HUMAN", variant: "amber" },
};

export function DecisionBadge({ decision }: { decision: PolicyDecision }) {
  const config = DECISION_CONFIG[decision];
  return <Badge variant={config.variant}>{config.label}</Badge>;
}

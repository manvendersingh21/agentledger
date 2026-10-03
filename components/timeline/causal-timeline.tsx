import type { ReactNode } from "react";
import Link from "next/link";
import type {
  AuditEventRow,
  DelegationRow,
  IntentRow,
  PolicyDecisionRow,
} from "@/lib/data/types";
import { CodeBlock } from "@/components/ui/code-block";
import { PolicyChecklist } from "@/components/timeline/policy-checklist";
import { formatCents, cn } from "@/lib/utils";
import { LocalTime } from "@/components/local-time";

export interface CausalTimelineInput {
  delegation: DelegationRow | null;
  contextEvents: AuditEventRow[];
  intentEvents: AuditEventRow[];
  intent: IntentRow;
  decision: PolicyDecisionRow | null;
  principalDisplayName: string;
  paymentProviderLabel: string;
}

type NodeTone = "neutral" | "sky" | "amber" | "emerald" | "red" | "violet";

interface TimelineNode {
  id: string;
  at: string;
  tone: NodeTone;
  title: string;
  body?: ReactNode;
  emphasis?: "blocked" | "duplicate";
}

const TONE_DOT: Record<NodeTone, string> = {
  neutral: "bg-accent ring-accent-wash",
  sky: "bg-accent ring-accent-soft",
  amber: "bg-waiting ring-waiting-bg",
  emerald: "bg-executed ring-executed-bg",
  red: "bg-blocked ring-blocked-bg",
  violet: "bg-duplicate ring-duplicate-bg",
};

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function merchantName(intent: IntentRow): string {
  const fromPayload = intent.payload.merchant_name;
  if (typeof fromPayload === "string" && fromPayload.length > 0) return fromPayload;
  return intent.merchant_slug;
}

function delegationNode(delegation: DelegationRow): TimelineNode {
  const at = delegation.valid_from || delegation.created_at;
  const recurringLabel = delegation.allow_recurring ? "subscriptions allowed" : "no subscriptions";
  return {
    id: `delegation-${delegation.id}`,
    at,
    tone: "sky",
    title: "Human delegation active",
    body: (
      <p className="text-sm text-ink-2">
        Max {formatCents(delegation.max_amount_cents)} per transaction ·{" "}
        {formatCents(delegation.daily_limit_cents)}/day · approval above{" "}
        {formatCents(delegation.approval_threshold_cents)} · {recurringLabel}
      </p>
    ),
  };
}

function contextEventNode(event: AuditEventRow): TimelineNode | null {
  const data = event.event_data;
  switch (event.event_type) {
    case "AGENT_AUTHENTICATED":
      return {
        id: event.id,
        at: event.created_at,
        tone: "neutral",
        title: "Agent authenticated",
        body: (
          <p className="text-xs text-ink-2">
            Channel {String(data.channel ?? "unknown")}
          </p>
        ),
      };
    case "PRODUCT_SEARCHED": {
      const query = typeof data.query === "string" ? data.query : "marketplace";
      const count = typeof data.result_count === "number" ? data.result_count : null;
      return {
        id: event.id,
        at: event.created_at,
        tone: "neutral",
        title: "Marketplace searched",
        body: (
          <p className="text-sm text-ink-2">
            Query <span className="font-mono text-ink">&quot;{query}&quot;</span>
            {count !== null ? ` · ${count} result${count === 1 ? "" : "s"}` : null}
          </p>
        ),
      };
    }
    case "UNTRUSTED_CONTENT_ENCOUNTERED": {
      const products = Array.isArray(data.products) ? data.products : [];
      const excerpts = products
        .map((p) => {
          const row = asRecord(p);
          const excerpt = typeof row.excerpt === "string" ? row.excerpt : null;
          const merchant = typeof row.merchant === "string" ? row.merchant : null;
          return excerpt ? { excerpt, merchant } : null;
        })
        .filter((x): x is { excerpt: string; merchant: string | null } => x !== null);
      const first = excerpts[0];
      return {
        id: event.id,
        at: event.created_at,
        tone: "red",
        title: "Untrusted merchant content retrieved",
        body: first ? (
          <div className="space-y-2">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-blocked">
              Untrusted · treated as data, not instructions
            </p>
            <CodeBlock title="Untrusted merchant content" tone="danger" value={first.excerpt} />
          </div>
        ) : (
          <p className="text-xs text-ink-2">External merchant text flagged as untrusted.</p>
        ),
      };
    }
    default:
      return null;
  }
}

function intentEventNode(
  event: AuditEventRow,
  input: CausalTimelineInput,
): TimelineNode | null {
  const data = event.event_data;
  const merchant = merchantName(input.intent);

  switch (event.event_type) {
    case "INTENT_PROPOSED":
      return {
        id: event.id,
        at: event.created_at,
        tone: "neutral",
        title: "Purchase proposed",
        body: (
          <div className="space-y-2 text-sm text-ink-2">
            <p>
              {formatCents(input.intent.amount_cents, input.intent.currency)} · recurring{" "}
              {input.intent.recurring ? "yes" : "no"}
            </p>
            {input.intent.payload.agent_claimed ? (
              <p className="font-mono text-xs text-ink-2">
                Agent-claimed payload recorded for audit
              </p>
            ) : null}
          </div>
        ),
      };
    case "PARAMETER_TAMPERING_DETECTED": {
      const claimed = asRecord(data.agent_claimed);
      const auth = asRecord(data.authoritative);
      const claimedAmount =
        typeof claimed.amount_cents === "number" ? claimed.amount_cents : null;
      const authAmount =
        typeof auth.amount_cents === "number" ? auth.amount_cents : input.intent.amount_cents;
      return {
        id: event.id,
        at: event.created_at,
        tone: "red",
        title: "Parameter tampering",
        body: (
          <div className="rounded-[4px] border border-blocked/30 bg-blocked-bg px-3.5 py-2.5 text-sm text-ink">
            <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-blocked">
              Parameter tampering
            </span>
            {" — "}
            agent claimed{" "}
            <span className="font-mono">{claimedAmount !== null ? formatCents(claimedAmount) : "—"}</span>,
            authoritative <span className="font-mono font-semibold">{formatCents(authAmount)}</span>
          </div>
        ),
      };
    }
    case "POLICY_EVALUATION_STARTED":
      return {
        id: event.id,
        at: event.created_at,
        tone: "neutral",
        title: "Policy evaluation started",
        body: <p className="text-xs text-ink-2">Deterministic rules against delegation</p>,
      };
    case "GUARDRAILS_EVALUATED": {
      const risk = asRecord(data.risk_signals);
      const inj = typeof risk.promptInjection === "number" ? risk.promptInjection : null;
      const crypto = typeof risk.cryptoExfiltration === "number" ? risk.cryptoExfiltration : null;
      const price = typeof risk.priceAnomaly === "number" ? risk.priceAnomaly : null;
      const source =
        typeof data.signal_source === "string" ? data.signal_source : "Jev assessment";
      return {
        id: event.id,
        at: event.created_at,
        tone: "neutral",
        title: "Guardrails evaluated",
        body: (
          <div className="space-y-2 text-sm text-ink-2">
            <p className="text-xs">{source}</p>
            {inj !== null && crypto !== null && price !== null ? (
              <p className="font-mono text-xs text-ink">
                injection {inj.toFixed(2)} · price anomaly {price.toFixed(2)} · crypto{" "}
                {crypto.toFixed(2)}
              </p>
            ) : (
              <p className="text-xs text-waiting">Risk signals unavailable — fails toward human approval</p>
            )}
            <PolicyChecklist decision={input.decision} merchantDisplayName={merchant} />
          </div>
        ),
      };
    }
    case "AGENT_KILL_SWITCH_TRIGGERED":
      return {
        id: event.id,
        at: event.created_at,
        tone: "red",
        title: "Agent kill switch triggered",
        emphasis: "blocked",
        body: (
          <div className="rounded-[4px] border border-blocked/50 bg-blocked/10 px-4 py-3 text-sm text-white">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-blocked">
              AGENT HALTED
            </p>
            <p className="mt-2 text-white/85">{String(data.reason ?? "Injection or exfiltration threshold exceeded")}</p>
          </div>
        ),
      };
    case "AGENT_REENABLED":
      return {
        id: event.id,
        at: event.created_at,
        tone: "emerald",
        title: "Agent re-enabled",
        body: (
          <p className="text-sm text-ink-2">
            Human cleared kill switch · channel {String(data.channel ?? "dashboard")}
          </p>
        ),
      };
    case "POLICY_DENIED":
      return {
        id: event.id,
        at: event.created_at,
        tone: "red",
        title: "Policy denied",
        emphasis: "blocked",
        body: (
          <div className="space-y-3">
            <PolicyChecklist decision={input.decision} merchantDisplayName={merchant} />
            {Array.isArray(data.reasons) && data.reasons.length > 0 ? (
              <ul className="list-inside list-disc text-xs text-white/75">
                {(data.reasons as string[]).map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            ) : null}
          </div>
        ),
      };
    case "POLICY_AUTO_APPROVED":
    case "POLICY_REQUIRES_APPROVAL":
      return {
        id: event.id,
        at: event.created_at,
        tone: event.event_type === "POLICY_REQUIRES_APPROVAL" ? "amber" : "emerald",
        title:
          event.event_type === "POLICY_REQUIRES_APPROVAL"
            ? "Policy passed — approval required"
            : "Policy auto-approved",
        body: <PolicyChecklist decision={input.decision} merchantDisplayName={merchant} />,
      };
    case "HUMAN_APPROVAL_REQUESTED":
      return {
        id: event.id,
        at: event.created_at,
        tone: "amber",
        title: "Human approval requested",
        body: (
          <p className="text-sm text-ink-2">
            {typeof data.product === "string" ? data.product : input.intent.payload.product_name} ·{" "}
            {formatCents(
              typeof data.amount_cents === "number" ? data.amount_cents : input.intent.amount_cents,
            )}
          </p>
        ),
      };
    case "HUMAN_APPROVED":
      return {
        id: event.id,
        at: event.created_at,
        tone: "sky",
        title: `${input.principalDisplayName} approved`,
        body: null,
      };
    case "HUMAN_DENIED":
      return {
        id: event.id,
        at: event.created_at,
        tone: "red",
        title: "Human denied",
        body: data.reason ? (
          <p className="text-xs text-ink-2">{String(data.reason)}</p>
        ) : null,
      };
    case "EXECUTION_STARTED":
      return {
        id: event.id,
        at: event.created_at,
        tone: "sky",
        title: "Execution started",
        body: (
          <p className="text-sm text-ink-2">
            Provider {String(data.provider_label ?? data.provider ?? input.paymentProviderLabel)}
          </p>
        ),
      };
    case "PAYMENT_SUCCEEDED": {
      const ref = typeof data.provider_reference === "string" ? data.provider_reference : null;
      const stripeUrl =
        ref && ref.startsWith("pi_")
          ? `https://dashboard.stripe.com/test/payments/${ref}`
          : null;
      return {
        id: event.id,
        at: event.created_at,
        tone: "emerald",
        title: "Payment succeeded",
        body: (
          <div className="space-y-1 text-sm">
            {ref ? (
              stripeUrl ? (
                <Link
                  href={stripeUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-mono text-xs text-accent hover:text-accent-hover hover:underline"
                >
                  {ref}
                </Link>
              ) : (
                <p className="font-mono text-xs text-ink">{ref}</p>
              )
            ) : null}
            <p className="text-ink-2">
              {formatCents(
                typeof data.amount_cents === "number" ? data.amount_cents : input.intent.amount_cents,
              )}
            </p>
          </div>
        ),
      };
    }
    case "PAYMENT_FAILED":
      return {
        id: event.id,
        at: event.created_at,
        tone: "red",
        title: "Payment failed",
        body: (
          <CodeBlock
            tone="danger"
            value={data.error ?? data}
            title="Provider error"
            className="mt-1"
          />
        ),
      };
    case "RECEIPT_CREATED":
      return {
        id: event.id,
        at: event.created_at,
        tone: "emerald",
        title: "Receipt generated",
        body: (
          <p className="font-mono text-xs text-ink-2">
            {typeof data.receipt_id === "string" ? data.receipt_id.slice(0, 8) + "…" : "Receipt on file"}
          </p>
        ),
      };
    case "DUPLICATE_EXECUTION_BLOCKED":
      return {
        id: event.id,
        at: event.created_at,
        tone: "violet",
        title: "Duplicate execution blocked",
        emphasis: "duplicate",
        body: (
          <p className="text-sm text-ink">
            Original transaction already committed · Additional charge {formatCents(0)}
          </p>
        ),
      };
    case "REPLAY_ATTEMPT_BLOCKED":
      return {
        id: event.id,
        at: event.created_at,
        tone: "violet",
        title: "Replay attempt blocked",
        body: <p className="text-xs text-ink-2">{String(data.reason ?? "not allowed")}</p>,
      };
    case "EVALUATION_FAILED_CLOSED":
      return {
        id: event.id,
        at: event.created_at,
        tone: "red",
        title: "Evaluation failed closed",
        emphasis: "blocked",
        body: <p className="text-sm text-white/80">{String(data.message ?? "Denied")}</p>,
      };
    default:
      return {
        id: event.id,
        at: event.created_at,
        tone: "neutral",
        title: event.event_type.replaceAll("_", " ").toLowerCase(),
        body: null,
      };
  }
}

export function buildCausalTimelineNodes(input: CausalTimelineInput): TimelineNode[] {
  const nodes: TimelineNode[] = [];

  if (input.delegation && input.delegation.status === "active") {
    nodes.push(delegationNode(input.delegation));
  }

  for (const event of input.contextEvents) {
    const node = contextEventNode(event);
    if (node) nodes.push(node);
  }

  for (const event of input.intentEvents) {
    const node = intentEventNode(event, input);
    if (node) nodes.push(node);
  }

  nodes.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
  return nodes;
}

export function CausalTimeline({ input }: { input: CausalTimelineInput }) {
  const nodes = buildCausalTimelineNodes(input);

  if (nodes.length === 0) {
    return (
      <p className="rounded-[6px] border border-line bg-surface px-4 py-10 text-center text-sm text-ink-2">
        No timeline events for this transaction yet.
      </p>
    );
  }

  return (
    <ol className="relative">
      {nodes.map((node, index) => {
        const blocked = node.emphasis === "blocked";
        const duplicate = node.emphasis === "duplicate";
        return (
          <li key={node.id} className="relative flex gap-4 pb-7 last:pb-0">
            {index < nodes.length - 1 ? (
              <span
                className="absolute left-[calc(5rem+4.5px)] top-4 bottom-0 w-px bg-line"
                aria-hidden
              />
            ) : null}
            <LocalTime
              iso={node.at}
              className="w-16 shrink-0 pt-0.5 text-right font-mono text-[11px] tabular-nums text-ink-3"
            />
            <span
              className={cn(
                "relative z-10 mt-1.5 size-2.5 shrink-0 rounded-full ring-4",
                TONE_DOT[node.tone],
              )}
              aria-hidden
            />
            <div
              className={cn(
                "min-w-0 flex-1 space-y-2",
                blocked && "rounded-[6px] bg-inverse p-5 text-white",
                duplicate && "rounded-[6px] border border-duplicate/30 bg-duplicate-bg p-5",
              )}
            >
              {blocked ? (
                <p className="font-display text-2xl font-semibold uppercase leading-none tracking-[-0.02em] text-blocked">
                  Action blocked
                </p>
              ) : null}
              {duplicate ? (
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-duplicate">
                  Duplicate blocked
                </p>
              ) : null}
              <p
                className={cn(
                  "font-medium",
                  blocked ? "text-white" : duplicate ? "text-duplicate" : "text-ink",
                )}
              >
                {node.title}
              </p>
              {node.body}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

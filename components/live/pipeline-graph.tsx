import type { ReactNode } from "react";
import type { LivePipelineSnapshot, LivePolicyRule } from "@/lib/data/live";

export type PipelineNodeState = "inactive" | "active" | "passed" | "blocked";

interface PipelineNode {
  key: string;
  eyebrow: string;
  title: string;
  state: PipelineNodeState;
  body: ReactNode;
}

const STATE_STYLES: Record<
  PipelineNodeState,
  { card: string; dot: string; pill: string; label: string; line: string }
> = {
  inactive: {
    card: "border-line bg-[#F7F7F7] text-ink-3",
    dot: "bg-ink-3",
    pill: "bg-neutral-bg text-neutral",
    label: "Inactive",
    line: "#CFCFCF",
  },
  active: {
    card: "border-accent bg-accent-wash text-ink shadow-[0_0_0_3px_rgba(0,0,255,0.08)]",
    dot: "animate-pulse bg-accent",
    pill: "bg-accent text-white",
    label: "Live",
    line: "#0000FF",
  },
  passed: {
    card: "border-executed bg-surface text-ink shadow-[0_0_0_3px_rgba(0,122,61,0.06)]",
    dot: "bg-executed",
    pill: "bg-executed-bg text-executed",
    label: "Passed",
    line: "#007A3D",
  },
  blocked: {
    card: "border-blocked bg-blocked-bg text-ink shadow-[0_0_0_3px_rgba(229,0,43,0.06)]",
    dot: "bg-blocked",
    pill: "bg-blocked text-white",
    label: "Blocked",
    line: "#E5002B",
  },
};

function formatMoney(cents: number, currency: string): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency.toUpperCase(),
    minimumFractionDigits: 2,
  }).format(cents / 100);
}

function shortId(value: string | null, size = 8): string {
  if (!value) return "—";
  if (value.length <= size * 2 + 1) return value;
  return `${value.slice(0, size)}…${value.slice(-4)}`;
}

function utcTime(value: string | null): string {
  if (!value) return "Not checked";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return `${date.toISOString().slice(0, 10)} ${date.toISOString().slice(11, 19)} UTC`;
}

function trustSourceLabel(source: string): string {
  if (source === "fixture") return "Demo fixture";
  if (source === "scamadvisor") return "ScamAdviser";
  return "Unavailable";
}

function rule(snapshot: LivePipelineSnapshot, key: string): LivePolicyRule | undefined {
  return snapshot.policy?.rules.find((entry) => entry.key === key);
}

function policyState(snapshot: LivePipelineSnapshot): PipelineNodeState {
  if (!snapshot.policy) {
    return snapshot.status === "proposed" || snapshot.status === "evaluating" ? "active" : "inactive";
  }
  return snapshot.policy.decision === "deny" ? "blocked" : "passed";
}

function trustState(snapshot: LivePipelineSnapshot): PipelineNodeState {
  if (!snapshot.policy) return snapshot.status === "evaluating" ? "active" : "inactive";
  return rule(snapshot, "guardrails.merchant_trust")?.passed === false ? "blocked" : "passed";
}

function jevState(snapshot: LivePipelineSnapshot): PipelineNodeState {
  if (!snapshot.policy) return snapshot.status === "evaluating" ? "active" : "inactive";
  const signalKeys = [
    "guardrails.prompt_injection",
    "guardrails.crypto_exfiltration",
    "guardrails.price_anomaly",
  ];
  if (signalKeys.some((key) => rule(snapshot, key)?.passed === false)) return "blocked";
  return snapshot.jev.available ? "passed" : "blocked";
}

function approvalState(snapshot: LivePipelineSnapshot): PipelineNodeState {
  if (!snapshot.policy) return "inactive";
  if (snapshot.policy.decision === "deny") return "inactive";
  if (!snapshot.approval) return snapshot.policy.decision === "auto_approve" ? "passed" : "active";
  if (snapshot.approval.status === "pending") return "active";
  if (snapshot.approval.status === "approved") return "passed";
  return "blocked";
}

function executionState(snapshot: LivePipelineSnapshot): PipelineNodeState {
  if (!snapshot.execution) {
    if (snapshot.status === "approved" || snapshot.status === "executing") return "active";
    return "inactive";
  }
  if (snapshot.execution.status === "pending") return "active";
  return snapshot.execution.status === "succeeded" ? "passed" : "blocked";
}

function receiptState(snapshot: LivePipelineSnapshot): PipelineNodeState {
  if (snapshot.receipt) return "passed";
  if (snapshot.execution?.status === "succeeded") return "active";
  return "inactive";
}

function auditState(snapshot: LivePipelineSnapshot): PipelineNodeState {
  if (!snapshot.audit.verified) return "blocked";
  return snapshot.audit.eventCount > 0 ? "passed" : "active";
}

function Detail({
  label,
  children,
  mono = false,
}: {
  label: string;
  children: ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="min-w-0">
      <dt className="text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-3">{label}</dt>
      <dd className={`mt-0.5 break-words text-[13px] leading-tight text-ink ${mono ? "font-mono" : ""}`}>
        {children}
      </dd>
    </div>
  );
}

function SignalBar({ label, value }: { label: string; value: number | null }) {
  const bounded = value === null ? 0 : Math.max(0, Math.min(1, value));
  const dangerous = value !== null && bounded >= 0.8;
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2 text-[11px]">
        <span className="truncate text-ink-2">{label}</span>
        <span className={`font-mono font-semibold ${dangerous ? "text-blocked" : "text-ink"}`}>
          {value === null ? "—" : value.toFixed(2)}
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-sm bg-line" aria-hidden>
        <div
          className={`h-full rounded-sm transition-[width] duration-700 ${
            dangerous ? "bg-blocked" : bounded >= 0.5 ? "bg-waiting" : "bg-executed"
          }`}
          style={{ width: `${bounded * 100}%` }}
        />
      </div>
    </div>
  );
}

function Connector({ state }: { state: PipelineNodeState }) {
  const color = STATE_STYLES[state].line;
  const animated = state === "active" || state === "passed";
  return (
    <>
      <svg
        viewBox="0 0 24 10"
        preserveAspectRatio="none"
        className="absolute left-full top-1/2 hidden h-4 w-5 -translate-y-1/2 lg:block"
        aria-hidden
      >
        <line x1="0" y1="5" x2="24" y2="5" stroke={color} strokeWidth="1.5" />
        <path d="M19 1.5L23 5l-4 3.5" fill="none" stroke={color} strokeWidth="1.5" />
        {animated ? (
          <circle r="2.2" cy="5" fill={color} className="motion-reduce:hidden">
            <animate attributeName="cx" values="1;19" dur="1.25s" repeatCount="indefinite" />
          </circle>
        ) : null}
      </svg>
      <svg
        viewBox="0 0 10 28"
        preserveAspectRatio="none"
        className="mx-auto h-7 w-4 lg:hidden"
        aria-hidden
      >
        <line x1="5" y1="0" x2="5" y2="28" stroke={color} strokeWidth="1.5" />
        <path d="M1.5 23L5 27l3.5-4" fill="none" stroke={color} strokeWidth="1.5" />
        {animated ? (
          <circle r="2.2" cx="5" fill={color} className="motion-reduce:hidden">
            <animate attributeName="cy" values="1;22" dur="1.25s" repeatCount="indefinite" />
          </circle>
        ) : null}
      </svg>
    </>
  );
}

function PipelineCard({ node, index }: { node: PipelineNode; index: number }) {
  const style = STATE_STYLES[node.state];
  return (
    <div className="relative min-w-0">
      <article
        className={`h-full min-h-[230px] rounded-[6px] border p-4 transition-colors duration-500 lg:min-h-[430px] ${style.card}`}
        aria-label={`${node.title}: ${style.label}`}
      >
        <div className="flex items-center justify-between gap-2">
          <span className="font-mono text-[10px] text-ink-3">{String(index + 1).padStart(2, "0")}</span>
          <span
            className={`inline-flex items-center gap-1.5 rounded-sm px-2 py-1 text-[9px] font-semibold uppercase tracking-[0.12em] ${style.pill}`}
          >
            <span className={`size-1.5 rounded-full ${style.dot}`} aria-hidden />
            {style.label}
          </span>
        </div>
        <p className="mt-5 text-[10px] font-semibold uppercase tracking-[0.14em] text-accent">{node.eyebrow}</p>
        <h2 className="mt-1 font-display text-[22px] font-semibold leading-[0.95] tracking-[-0.04em] text-ink">
          {node.title}
        </h2>
        <div className="mt-5">{node.body}</div>
      </article>
    </div>
  );
}

export function PipelineGraph({ snapshot }: { snapshot: LivePipelineSnapshot }) {
  const trustCheck = rule(snapshot, "guardrails.merchant_trust");
  const nodes: PipelineNode[] = [
    {
      key: "agent",
      eyebrow: "Origin",
      title: "Agent",
      state: "passed",
      body: (
        <dl className="space-y-4">
          <Detail label="Name">{snapshot.agent.name}</Detail>
          <Detail label="Channel">
            <span className="inline-flex rounded-sm bg-accent-wash px-2 py-1 font-mono text-xs font-semibold text-accent">
              {snapshot.channel}
            </span>
          </Detail>
          <Detail label="Type">{snapshot.agent.type}</Detail>
        </dl>
      ),
    },
    {
      key: "intent",
      eyebrow: "Authoritative",
      title: "Action intent",
      state: "passed",
      body: (
        <dl className="space-y-3">
          <Detail label="Product">{snapshot.intent.productName}</Detail>
          <Detail label="Merchant">{snapshot.intent.merchantName}</Detail>
          <Detail label="Amount" mono>
            <span className="text-lg font-semibold">
              {formatMoney(snapshot.intent.amountCents, snapshot.intent.currency)}
            </span>
          </Detail>
          <div className="grid grid-cols-2 gap-2">
            <Detail label="Quantity" mono>{snapshot.intent.quantity}</Detail>
            <Detail label="Recurring">{snapshot.intent.recurring ? "Yes" : "No"}</Detail>
          </div>
          <Detail label="Intent" mono>{shortId(snapshot.id)}</Detail>
        </dl>
      ),
    },
    {
      key: "trust",
      eyebrow: "External signal",
      title: "ScamAdviser trust",
      state: trustState(snapshot),
      body: (
        <dl className="space-y-4">
          <Detail label="Score" mono>
            <span className="font-display text-5xl font-semibold tracking-[-0.05em]">
              {snapshot.trust.score ?? "—"}
            </span>
            <span className="ml-1 text-xs text-ink-3">/ 100</span>
          </Detail>
          <Detail label="Source">{trustSourceLabel(snapshot.trust.source)}</Detail>
          <Detail label="Domain" mono>{snapshot.trust.domain ?? "Unknown"}</Detail>
          <Detail label="Checked">{utcTime(snapshot.trust.checkedAt)}</Detail>
          {trustCheck?.values ? <p className="text-[11px] leading-snug text-ink-2">{trustCheck.values}</p> : null}
        </dl>
      ),
    },
    {
      key: "jev",
      eyebrow: "External signal",
      title: "Jev signals",
      state: jevState(snapshot),
      body: (
        <div className="space-y-4">
          <div className="space-y-3">
            <SignalBar label="Injection" value={snapshot.jev.promptInjection} />
            <SignalBar label="Crypto" value={snapshot.jev.cryptoExfiltration} />
            <SignalBar label="Price" value={snapshot.jev.priceAnomaly} />
            <SignalBar label="Merchant risk" value={snapshot.jev.merchantRisk} />
          </div>
          <dl className="grid grid-cols-2 gap-3 border-t border-line pt-3">
            <Detail label="Provider">{snapshot.jev.provider ?? "Unavailable"}</Detail>
            <Detail label="Model" mono>{snapshot.jev.model ?? "—"}</Detail>
          </dl>
          <p className="text-[10px] uppercase tracking-[0.1em] text-ink-3">
            {snapshot.jev.cached ? "Cached assessment" : snapshot.jev.available ? "Live assessment" : "Fails toward human"}
          </p>
        </div>
      ),
    },
    {
      key: "policy",
      eyebrow: "Authorization",
      title: "Deterministic policy",
      state: policyState(snapshot),
      body: snapshot.policy ? (
        <div>
          <div
            className={`inline-flex rounded-sm px-3 py-2 font-display text-xl font-semibold tracking-[-0.03em] ${
              snapshot.policy.decision === "deny"
                ? "bg-blocked text-white"
                : snapshot.policy.decision === "require_approval"
                  ? "bg-waiting-bg text-waiting"
                  : "bg-executed-bg text-executed"
            }`}
          >
            {snapshot.policy.decision === "deny"
              ? "DENY"
              : snapshot.policy.decision === "require_approval"
                ? "HUMAN"
                : "AUTO"}
          </div>
          <ul className="mt-4 grid gap-x-3 gap-y-2 sm:grid-cols-2">
            {snapshot.policy.rules.map((policyRule) => (
              <li key={policyRule.key} className="min-w-0 border-t border-line pt-1.5">
                <div className="flex items-start gap-1.5">
                  <span
                    className={`font-mono text-xs font-bold ${
                      policyRule.passed ? "text-executed" : "text-blocked"
                    }`}
                    aria-label={policyRule.passed ? "passed" : "failed"}
                  >
                    {policyRule.passed ? "✓" : "✕"}
                  </span>
                  <div className="min-w-0">
                    <p className="text-[11px] font-semibold leading-tight text-ink">{policyRule.label}</p>
                    {policyRule.values ? (
                      <p className="mt-0.5 break-words font-mono text-[9px] leading-tight text-ink-3">
                        {policyRule.values}
                      </p>
                    ) : null}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="text-sm leading-relaxed text-ink-2">Rules are evaluating against authoritative terms.</p>
      ),
    },
    {
      key: "approval",
      eyebrow: "Human control",
      title: "Human approval",
      state: approvalState(snapshot),
      body: (
        <dl className="space-y-4">
          <Detail label="Status">
            {snapshot.approval?.status ??
              (snapshot.policy?.decision === "auto_approve" ? "Not required" : "Waiting for policy")}
          </Detail>
          <Detail label="Hash-bound intent" mono>
            {shortId(snapshot.approval?.intentHash ?? null, 10)}
          </Detail>
          <Detail label="Requested">{utcTime(snapshot.approval?.requestedAt ?? null)}</Detail>
          {snapshot.approval?.resolvedAt ? (
            <Detail label="Resolved">{utcTime(snapshot.approval.resolvedAt)}</Detail>
          ) : null}
          <p className="border-t border-line pt-3 text-[11px] leading-snug text-ink-2">
            Approval is valid only for the exact canonical intent hash.
          </p>
        </dl>
      ),
    },
    {
      key: "stripe",
      eyebrow: "Test mode",
      title: "Stripe execution",
      state: executionState(snapshot),
      body: (
        <dl className="space-y-4">
          <Detail label="Status">{snapshot.execution?.status ?? "Not started"}</Detail>
          <Detail label="PaymentIntent" mono>
            {shortId(snapshot.execution?.paymentIntentId ?? null, 10)}
          </Detail>
          <Detail label="Provider">{snapshot.execution?.provider ?? "Stripe test"}</Detail>
          <Detail label="Started">{utcTime(snapshot.execution?.startedAt ?? null)}</Detail>
        </dl>
      ),
    },
    {
      key: "receipt",
      eyebrow: "Evidence",
      title: "Receipt",
      state: receiptState(snapshot),
      body: snapshot.receipt ? (
        <dl className="space-y-4">
          <Detail label="Amount" mono>
            <span className="text-xl font-semibold">
              {formatMoney(snapshot.receipt.amountCents, snapshot.receipt.currency)}
            </span>
          </Detail>
          <Detail label="Reference" mono>{shortId(snapshot.receipt.providerReference, 10)}</Detail>
          <Detail label="Receipt ID" mono>{shortId(snapshot.receipt.id)}</Detail>
          <Detail label="Created">{utcTime(snapshot.receipt.createdAt)}</Detail>
        </dl>
      ) : (
        <p className="text-sm leading-relaxed text-ink-2">Created only after successful test execution.</p>
      ),
    },
    {
      key: "audit",
      eyebrow: "Integrity",
      title: "Audit chain",
      state: auditState(snapshot),
      body: (
        <dl className="space-y-4">
          <Detail label="Intent events" mono>
            <span className="font-display text-5xl font-semibold tracking-[-0.05em]">
              {snapshot.audit.eventCount}
            </span>
          </Detail>
          <Detail label="Chain">
            <span
              className={`inline-flex rounded-sm px-2 py-1 text-[11px] font-semibold uppercase tracking-[0.1em] ${
                snapshot.audit.verified ? "bg-executed-bg text-executed" : "bg-blocked-bg text-blocked"
              }`}
            >
              {snapshot.audit.verified ? "Verified" : "Broken"}
            </span>
          </Detail>
          <Detail label="Chain events checked" mono>{snapshot.audit.verifiedCount}</Detail>
          <Detail label="Latest hash" mono>{shortId(snapshot.audit.latestHash)}</Detail>
          {snapshot.audit.reason ? <p className="text-[11px] text-blocked">{snapshot.audit.reason}</p> : null}
        </dl>
      ),
    },
  ];

  return (
    <div
      className="grid grid-cols-1 lg:min-w-[1710px] lg:grid-cols-[150px_180px_160px_210px_350px_190px_190px_150px_180px] lg:gap-5"
      aria-label="Live AgentLedger pipeline"
    >
      {nodes.map((node, index) => (
        <div key={node.key} className="relative">
          <PipelineCard node={node} index={index} />
          {index < nodes.length - 1 ? <Connector state={nodes[index + 1].state} /> : null}
        </div>
      ))}
    </div>
  );
}

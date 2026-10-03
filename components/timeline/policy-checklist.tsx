import { Check, X } from "lucide-react";
import type { PolicyDecisionRow } from "@/lib/data/types";
import { formatCents } from "@/lib/utils";
import { cn } from "@/lib/utils";

type RuleEntry = { passed: boolean; [key: string]: unknown };

function ruleRow(
  passed: boolean,
  label: string,
  detail?: string,
): { passed: boolean; label: string; detail?: string } {
  return { passed, label, detail };
}

function linesFromRules(
  rules: Record<string, RuleEntry>,
  merchantDisplayName?: string,
): { passed: boolean; label: string; detail?: string }[] {
  const rows: { passed: boolean; label: string; detail?: string }[] = [];

  const active = rules.active_delegation;
  if (active) {
    rows.push(
      ruleRow(
        active.passed,
        "Active delegation",
        active.passed ? undefined : String(active.reason ?? "No active delegation"),
      ),
    );
  }

  const tx = rules.transaction_limit;
  if (tx && typeof tx.limit === "number" && typeof tx.actual === "number") {
    rows.push(
      ruleRow(
        tx.passed,
        "Transaction limit",
        `requested ${formatCents(tx.actual)} · maximum ${formatCents(tx.limit)}`,
      ),
    );
  }

  const daily = rules.daily_limit;
  if (
    daily &&
    typeof daily.limit === "number" &&
    typeof daily.spent === "number" &&
    typeof daily.requested === "number"
  ) {
    rows.push(
      ruleRow(
        daily.passed,
        "Daily limit",
        `requested ${formatCents(daily.requested)} · ${formatCents(daily.spent)} spent today · cap ${formatCents(daily.limit)}`,
      ),
    );
  }

  const recurring = rules.recurring;
  if (recurring && typeof recurring.requested === "boolean") {
    const detail = recurring.requested && !recurring.allowed
      ? "recurring purchases disabled"
      : recurring.requested
        ? "recurring purchase requested"
        : "one-time purchase";
    rows.push(ruleRow(recurring.passed, "Recurring", detail));
  }

  const merchant = rules.merchant;
  if (merchant && typeof merchant.requested === "string") {
    const name = merchantDisplayName ?? merchant.requested;
    rows.push(
      ruleRow(
        merchant.passed,
        "Merchant allowlist",
        merchant.passed ? `${name} authorized` : `${name} not authorized`,
      ),
    );
  }

  const approval = rules.approval_threshold;
  if (approval && typeof approval.threshold === "number" && typeof approval.actual === "number") {
    const needs = approval.requires_approval === true;
    rows.push(
      ruleRow(
        approval.passed,
        "Approval threshold",
        needs
          ? `Human approval required above ${formatCents(approval.threshold)}`
          : `within auto-approve limit (${formatCents(approval.actual)} ≤ ${formatCents(approval.threshold)})`,
      ),
    );
  }

  return rows;
}

function trustSourceLabel(source: unknown): string {
  if (source === "fixture") return "demo fixture";
  if (source === "scamadvisor") return "ScamAdvisor";
  return typeof source === "string" ? source : "unknown";
}

function linesFromGuardrailChecks(
  guardrails: unknown,
): { passed: boolean; label: string; detail?: string }[] {
  if (!guardrails || typeof guardrails !== "object") return [];
  const checks = guardrails as Record<string, RuleEntry>;
  const rows: { passed: boolean; label: string; detail?: string }[] = [];

  const agentActive = checks.agent_active;
  if (agentActive) {
    const status = typeof agentActive.status === "string" ? agentActive.status : "unknown";
    rows.push(
      ruleRow(
        agentActive.passed,
        "Agent status",
        agentActive.passed ? "Agent active" : `Agent ${status} — proposals blocked`,
      ),
    );
  }

  const trust = checks.merchant_trust;
  if (trust) {
    const score = typeof trust.trustScore === "number" ? trust.trustScore : null;
    const min = typeof trust.minTrustScore === "number" ? trust.minTrustScore : null;
    const source = trustSourceLabel(trust.trustSource);
    const domain = typeof trust.domain === "string" ? trust.domain : null;
    const override = trust.overrideApplied === true;
    let detail = domain ? `${domain}` : "Merchant domain";
    if (override) detail += " · human override";
    else if (score !== null && min !== null) detail += ` · trust ${score} (${source}) · min ${min}`;
    else detail += " · trust score unavailable";
    rows.push(ruleRow(trust.passed, "Merchant trust", detail));
  }

  const jev = checks.jev_available;
  if (jev && jev.passed === false) {
    rows.push(ruleRow(false, "Jev risk signals", String(jev.reason ?? "Unavailable — escalates to human")));
  }

  const injection = checks.prompt_injection;
  if (injection && injection.skipped !== true) {
    const score = typeof injection.score === "number" ? injection.score : null;
    const threshold = typeof injection.threshold === "number" ? injection.threshold : null;
    rows.push(
      ruleRow(
        injection.passed,
        "Prompt injection",
        score !== null && threshold !== null
          ? `score ${score.toFixed(2)} · kill ≥ ${threshold.toFixed(2)}`
          : undefined,
      ),
    );
  }

  const crypto = checks.crypto_exfiltration;
  if (crypto && crypto.skipped !== true) {
    const score = typeof crypto.score === "number" ? crypto.score : null;
    const threshold = typeof crypto.threshold === "number" ? crypto.threshold : null;
    rows.push(
      ruleRow(
        crypto.passed,
        "Crypto exfiltration",
        score !== null && threshold !== null
          ? `score ${score.toFixed(2)} · kill ≥ ${threshold.toFixed(2)}`
          : undefined,
      ),
    );
  }

  const price = checks.price_anomaly;
  if (price && price.skipped !== true) {
    const score = typeof price.score === "number" ? price.score : null;
    const deny = typeof price.denyThreshold === "number" ? price.denyThreshold : null;
    const review = typeof price.reviewThreshold === "number" ? price.reviewThreshold : null;
    rows.push(
      ruleRow(
        price.passed,
        "Price anomaly",
        score !== null && deny !== null && review !== null
          ? `score ${score.toFixed(2)} · deny ≥ ${deny.toFixed(2)} · review ≥ ${review.toFixed(2)}`
          : undefined,
      ),
    );
  }

  return rows;
}

export interface PolicyChecklistProps {
  decision: PolicyDecisionRow | null;
  merchantDisplayName?: string;
  className?: string;
}

export function PolicyChecklist({ decision, merchantDisplayName, className }: PolicyChecklistProps) {
  if (!decision) {
    return (
      <p className={cn("text-xs text-muted-foreground", className)}>No policy evaluation recorded.</p>
    );
  }

  const rules = decision.rules_evaluated as Record<string, RuleEntry>;
  const rows = [
    ...linesFromRules(rules, merchantDisplayName),
    ...linesFromGuardrailChecks(rules.guardrails),
  ];

  return (
    <ul className={cn("space-y-2", className)}>
      {rows.map((row) => (
        <li key={row.label} className="flex gap-2 text-sm">
          <span
            className={cn(
              "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border",
              row.passed
                ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-400"
                : "border-red-500/40 bg-red-500/10 text-red-400",
            )}
            aria-hidden
          >
            {row.passed ? <Check className="size-2.5" /> : <X className="size-2.5" />}
          </span>
          <div className="min-w-0">
            <p className="font-medium text-foreground/90">{row.label}</p>
            {row.detail ? <p className="text-xs text-muted-foreground">{row.detail}</p> : null}
          </div>
        </li>
      ))}
    </ul>
  );
}

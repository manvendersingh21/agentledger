export type GuardrailViolation =
  | "AGENT_SUSPENDED"
  | "MERCHANT_TRUST_TOO_LOW"
  | "MERCHANT_TRUST_UNKNOWN"
  | "PROMPT_INJECTION_DETECTED"
  | "CRYPTO_EXFILTRATION_DETECTED"
  | "PRICE_ANOMALY";

export interface GuardrailInput {
  agentStatus: "active" | "disabled" | "suspended";
  merchant: { slug: string; domain: string | null; trustScore: number | null; trustSource: string };
  policy: {
    minTrustScore: number;
    trustedDomainOverrides: string[];
    priceAnomalyDenyThreshold: number;
    priceAnomalyReviewThreshold: number;
    injectionKillThreshold: number;
    killSwitchEnabled: boolean;
  };
  risk: { promptInjection: number; cryptoExfiltration: number; priceAnomaly: number } | null;
}

export interface GuardrailResult {
  violations: GuardrailViolation[];
  requireApproval: boolean;
  killSwitch: { trigger: boolean; reason: string | null };
  checks: Record<string, { passed: boolean; [k: string]: unknown }>;
}

function domainInOverrides(domain: string | null, overrides: string[]): boolean {
  if (domain === null || domain.length === 0) {
    return false;
  }
  const normalized = domain.toLowerCase();
  return overrides.some((entry) => entry.toLowerCase() === normalized);
}

export function evaluateGuardrails(input: GuardrailInput): GuardrailResult {
  const violations: GuardrailViolation[] = [];
  let requireApproval = false;

  const agentActive = input.agentStatus === "active";
  const checks: GuardrailResult["checks"] = {
    agent_active: { passed: agentActive, status: input.agentStatus },
  };
  if (!agentActive) {
    violations.push("AGENT_SUSPENDED");
  }

  const overridePass = domainInOverrides(input.merchant.domain, input.policy.trustedDomainOverrides);
  let trustPassed = overridePass;
  if (!overridePass) {
    if (input.merchant.trustScore === null) {
      violations.push("MERCHANT_TRUST_UNKNOWN");
      trustPassed = false;
    } else if (input.merchant.trustScore < input.policy.minTrustScore) {
      violations.push("MERCHANT_TRUST_TOO_LOW");
      trustPassed = false;
    } else {
      trustPassed = true;
    }
  }
  checks.merchant_trust = {
    passed: trustPassed,
    slug: input.merchant.slug,
    domain: input.merchant.domain,
    trustScore: input.merchant.trustScore,
    trustSource: input.merchant.trustSource,
    minTrustScore: input.policy.minTrustScore,
    overrideApplied: overridePass,
  };

  if (input.risk === null) {
    requireApproval = true;
    checks.jev_available = { passed: false, reason: "unavailable" };
    checks.prompt_injection = { passed: true, skipped: true };
    checks.crypto_exfiltration = { passed: true, skipped: true };
    checks.price_anomaly = { passed: true, skipped: true };
  } else {
    checks.jev_available = { passed: true };

    const injectionDetected = input.risk.promptInjection >= input.policy.injectionKillThreshold;
    checks.prompt_injection = {
      passed: !injectionDetected,
      score: input.risk.promptInjection,
      threshold: input.policy.injectionKillThreshold,
    };
    if (injectionDetected) {
      violations.push("PROMPT_INJECTION_DETECTED");
    }

    const cryptoDetected = input.risk.cryptoExfiltration >= input.policy.injectionKillThreshold;
    checks.crypto_exfiltration = {
      passed: !cryptoDetected,
      score: input.risk.cryptoExfiltration,
      threshold: input.policy.injectionKillThreshold,
    };
    if (cryptoDetected) {
      violations.push("CRYPTO_EXFILTRATION_DETECTED");
    }

    const priceDeny = input.risk.priceAnomaly >= input.policy.priceAnomalyDenyThreshold;
    const priceReview =
      !priceDeny && input.risk.priceAnomaly >= input.policy.priceAnomalyReviewThreshold;
    checks.price_anomaly = {
      passed: !priceDeny,
      score: input.risk.priceAnomaly,
      denyThreshold: input.policy.priceAnomalyDenyThreshold,
      reviewThreshold: input.policy.priceAnomalyReviewThreshold,
      requiresReview: priceReview,
    };
    if (priceDeny) {
      violations.push("PRICE_ANOMALY");
    }
    if (priceReview) {
      requireApproval = true;
    }
  }

  const hasKillViolation =
    violations.includes("PROMPT_INJECTION_DETECTED") ||
    violations.includes("CRYPTO_EXFILTRATION_DETECTED");
  let killReason: string | null = null;
  if (input.policy.killSwitchEnabled && hasKillViolation && input.risk !== null) {
    if (violations.includes("PROMPT_INJECTION_DETECTED")) {
      killReason = `promptInjection ${input.risk.promptInjection} exceeded threshold ${input.policy.injectionKillThreshold}`;
    } else {
      killReason = `cryptoExfiltration ${input.risk.cryptoExfiltration} exceeded threshold ${input.policy.injectionKillThreshold}`;
    }
  }
  const killSwitch = {
    trigger: killReason !== null,
    reason: killReason,
  };
  checks.kill_switch = {
    passed: !killSwitch.trigger,
    enabled: input.policy.killSwitchEnabled,
    triggered: killSwitch.trigger,
    reason: killReason,
  };

  return { violations, requireApproval, killSwitch, checks };
}

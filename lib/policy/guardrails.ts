export type GuardrailViolation =
  | "AGENT_SUSPENDED"
  | "MERCHANT_TRUST_TOO_LOW"
  | "MERCHANT_TRUST_UNKNOWN"
  | "PROMPT_INJECTION_DETECTED"
  | "CRYPTO_EXFILTRATION_DETECTED"
  | "PRICE_ANOMALY"
  | "MERCHANT_NOT_VERIFIED"
  | "WEBSITE_NOT_ALLOWED"
  | "CATEGORY_BLOCKED"
  | "CATEGORY_NOT_ALLOWED"
  | "PRICE_ABOVE_MARKET"
  | "MERCHANT_RISK_HIGH";

/**
 * Deny threshold for Jev's merchantRisk signal — P(merchant is unsafe to transact with), scored
 * from the live ScamAdviser trust score, verification status and listing content.
 * Policy constant for now; configurable per delegation later.
 */
export const MERCHANT_RISK_DENY_THRESHOLD = 0.9;

/**
 * NOT a violation: external (unverified website) purchases can pass every deny rule,
 * but they are never auto-approved — this reason deterministically forces require_approval.
 */
export const EXTERNAL_REQUIRES_HUMAN = "EXTERNAL_REQUIRES_HUMAN";

/** Label shown with external purchases: the price came from the agent, not a verified catalog. */
export const UNVERIFIED_PRICE_LABEL = "UNVERIFIED PRICE — agent-claimed";

export type RequireApprovalReason =
  | typeof EXTERNAL_REQUIRES_HUMAN
  | "RISK_SIGNALS_UNAVAILABLE"
  | "PRICE_ANOMALY_REVIEW";

export interface GuardrailInput {
  agentStatus: "active" | "disabled" | "suspended";
  merchant: { slug: string; domain: string | null; trustScore: number | null; trustSource: string };
  purchase: { category: string; unitPriceCents: number; quantity: number; external: boolean };
  productMarketPriceCents: number | null;
  policy: {
    minTrustScore: number;
    trustedDomainOverrides: string[];
    priceAnomalyDenyThreshold: number;
    priceAnomalyReviewThreshold: number;
    injectionKillThreshold: number;
    killSwitchEnabled: boolean;
    allowedDomains: string[];
    blockedCategories: string[];
    allowedCategories: string[];
    marketPriceTolerance: number;
  };
  risk: {
    promptInjection: number;
    cryptoExfiltration: number;
    priceAnomaly: number;
    /** Jev merchantRisk signal; absent/null when the cached assessment predates the question. */
    merchantRisk?: number | null;
  } | null;
}

export interface GuardrailResult {
  violations: GuardrailViolation[];
  requireApproval: boolean;
  /** Why approval is forced even without violations (e.g. EXTERNAL_REQUIRES_HUMAN). Empty when not forced. */
  requireApprovalReasons: RequireApprovalReason[];
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

function hostnameInList(domain: string | null, list: string[]): boolean {
  if (domain === null || domain.length === 0) {
    return false;
  }
  const host = domain.trim().toLowerCase();
  return list.some((entry) => {
    const allowed = entry.trim().toLowerCase();
    if (!allowed) return false;
    return host === allowed || host.endsWith(`.${allowed}`);
  });
}

function hostnameAllowed(domain: string | null, allowedDomains: string[]): boolean {
  if (allowedDomains.length === 0) {
    return true;
  }
  return hostnameInList(domain, allowedDomains);
}

/**
 * External (unverified website) merchant allowlist rule: an external domain passes only when the
 * human put it in allowed_domains or trusted_domain_overrides. An empty allowlist denies externals.
 */
export function externalDomainAllowed(
  domain: string | null,
  policy: { allowedDomains: string[]; trustedDomainOverrides: string[] },
): boolean {
  return (
    domainInOverrides(domain, policy.trustedDomainOverrides) ||
    hostnameInList(domain, policy.allowedDomains)
  );
}

export function evaluateGuardrails(input: GuardrailInput): GuardrailResult {
  const violations: GuardrailViolation[] = [];
  const requireApprovalReasons: RequireApprovalReason[] = [];
  let requireApproval = false;
  const external = input.purchase.external;

  const agentActive = input.agentStatus === "active";
  const checks: GuardrailResult["checks"] = {
    agent_active: { passed: agentActive, status: input.agentStatus },
  };
  if (!agentActive) {
    violations.push("AGENT_SUSPENDED");
  }

  // Trust rule: overrides always satisfy it; for external domains, allowed_domains does too
  // ("trust ≥ min unless domain in trusted_domain_overrides/allowed_domains").
  const overridePass =
    domainInOverrides(input.merchant.domain, input.policy.trustedDomainOverrides) ||
    (external && hostnameInList(input.merchant.domain, input.policy.allowedDomains));
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

  // Website rule: catalog merchants pass when the allowlist is empty (unrestricted); external
  // domains pass the merchant rule ONLY when listed in allowed_domains or trusted_domain_overrides.
  const websiteAllowed = external
    ? externalDomainAllowed(input.merchant.domain, input.policy)
    : hostnameAllowed(input.merchant.domain, input.policy.allowedDomains);
  checks.allowed_websites = {
    passed: websiteAllowed,
    domain: input.merchant.domain,
    allowedDomains: input.policy.allowedDomains,
    restricted: external || input.policy.allowedDomains.length > 0,
    external,
  };
  if (!websiteAllowed) {
    violations.push("WEBSITE_NOT_ALLOWED");
  }

  // External purchases are never auto-approved: a passing external proposal still goes to the human.
  // EXTERNAL_REQUIRES_HUMAN is deliberately NOT a violation (it does not deny).
  checks.external_source = {
    passed: true,
    external,
    requiresHuman: external,
    reason: external ? EXTERNAL_REQUIRES_HUMAN : null,
    priceLabel: external ? UNVERIFIED_PRICE_LABEL : null,
  };
  if (external) {
    requireApproval = true;
    requireApprovalReasons.push(EXTERNAL_REQUIRES_HUMAN);
  }

  const category = input.purchase.category;
  const blocked = input.policy.blockedCategories;
  const categoryBlocked = blocked.includes(category);
  checks.category_blocked = {
    passed: !categoryBlocked,
    category,
    blockedCategories: blocked,
  };
  if (categoryBlocked) {
    violations.push("CATEGORY_BLOCKED");
  }

  const allowed = input.policy.allowedCategories;
  const categoryRestricted = allowed.length > 0;
  const categoryAllowed = !categoryRestricted || allowed.includes(category);
  checks.category_allowed = {
    passed: categoryAllowed,
    category,
    allowedCategories: allowed,
    restricted: categoryRestricted,
  };
  if (categoryRestricted && !categoryAllowed) {
    violations.push("CATEGORY_NOT_ALLOWED");
  }

  const market = input.productMarketPriceCents;
  let priceAboveMarket = false;
  if (market !== null && market > 0) {
    const ceiling = input.policy.marketPriceTolerance * market;
    priceAboveMarket = input.purchase.unitPriceCents > ceiling;
  }
  checks.market_price = {
    passed: !priceAboveMarket,
    unitPriceCents: input.purchase.unitPriceCents,
    marketPriceCents: market,
    tolerance: input.policy.marketPriceTolerance,
    ceilingCents: market !== null && market > 0 ? input.policy.marketPriceTolerance * market : null,
  };
  if (priceAboveMarket) {
    violations.push("PRICE_ABOVE_MARKET");
  }

  if (input.risk === null) {
    requireApproval = true;
    requireApprovalReasons.push("RISK_SIGNALS_UNAVAILABLE");
    checks.jev_available = { passed: false, reason: "unavailable" };
    checks.prompt_injection = { passed: true, skipped: true };
    checks.crypto_exfiltration = { passed: true, skipped: true };
    checks.price_anomaly = { passed: true, skipped: true };
    checks.merchant_risk = { passed: true, skipped: true };
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
      requireApprovalReasons.push("PRICE_ANOMALY_REVIEW");
    }

    // Merchant risk: Jev's judgment of the merchant itself (trust score + verification + content).
    // Absent on cached assessments that predate the question — then this rule is skipped, never guessed.
    const merchantRisk = input.risk.merchantRisk ?? null;
    const merchantRiskHigh = merchantRisk !== null && merchantRisk >= MERCHANT_RISK_DENY_THRESHOLD;
    checks.merchant_risk = {
      passed: !merchantRiskHigh,
      score: merchantRisk,
      threshold: MERCHANT_RISK_DENY_THRESHOLD,
      available: merchantRisk !== null,
    };
    if (merchantRiskHigh) {
      violations.push("MERCHANT_RISK_HIGH");
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

  return { violations, requireApproval, requireApprovalReasons, killSwitch, checks };
}

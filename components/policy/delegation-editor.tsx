"use client";

import { useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { BadgeCheck, Check, Loader2, ShieldAlert, X } from "lucide-react";
import type { DelegationRow, MerchantRow } from "@/lib/data/types";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { ArrowButton } from "@/components/brand/arrow-button";
import { Eyebrow } from "@/components/brand/eyebrow";
import { WebsiteTrustCheck } from "@/components/policy/website-trust-check";
import { formatCents, cn } from "@/lib/utils";

function merchantTrustSourceLabel(source: string | undefined): string {
  if (source === "fixture") return "demo fixture";
  if (source === "scamadvisor") return "ScamAdviser";
  return source ?? "unknown";
}

function dollarsToCents(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const n = Number.parseFloat(trimmed);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

function centsToDollars(cents: number): string {
  return (cents / 100).toFixed(2).replace(/\.00$/, "").replace(/(\.\d)0$/, "$1");
}

interface PolicyStatement {
  active: boolean;
  merchantPhrase: string;
  recurringPhrase: string;
}

function buildStatement(
  allowRecurring: boolean,
  allowedSlugs: string[],
  merchants: MerchantRow[],
  active: boolean,
): PolicyStatement {
  const trustedCount = allowedSlugs.filter((slug) => {
    const m = merchants.find((x) => x.slug === slug);
    return m?.trusted !== false;
  }).length;
  const merchantPhrase =
    allowedSlugs.length === 0
      ? "no merchants"
      : allowedSlugs.length === merchants.length
        ? "any catalog merchant"
        : `${trustedCount} trusted merchant${trustedCount === 1 ? "" : "s"}`;
  const recurringPhrase = allowRecurring
    ? "one-time and subscription purchases"
    : "one-time purchases";
  return { active, merchantPhrase, recurringPhrase };
}

function Num({ children }: { children: ReactNode }) {
  return <span className="font-mono tabular-nums text-accent">{children}</span>;
}

function Section({
  eyebrow,
  title,
  description,
  className,
  children,
}: {
  eyebrow: string;
  title: string;
  description?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section
      className={cn("rounded-[6px] border border-line bg-surface p-6 sm:p-8", className)}
    >
      <div className="mb-6 space-y-2">
        <Eyebrow>{eyebrow}</Eyebrow>
        <h2 className="font-display text-2xl font-semibold leading-[0.95] tracking-[-0.045em] text-ink">
          {title}
        </h2>
        {description ? <p className="text-sm text-ink-2">{description}</p> : null}
      </div>
      {children}
    </section>
  );
}

function ToggleRow({
  id,
  label,
  hint,
  checked,
  onCheckedChange,
  ariaLabel,
}: {
  id: string;
  label: string;
  hint: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  ariaLabel: string;
}) {
  return (
    <div className="flex items-center justify-between gap-4 border-t border-line py-4 first:border-t-0 first:pt-0 last:pb-0">
      <div className="space-y-1">
        <Label htmlFor={id} className="text-[15px] font-medium text-ink">
          {label}
        </Label>
        <p className="text-xs text-ink-3">{hint}</p>
      </div>
      <Switch id={id} checked={checked} onCheckedChange={onCheckedChange} aria-label={ariaLabel} />
    </div>
  );
}

function Field({
  id,
  label,
  hint,
  children,
  className,
}: {
  id: string;
  label: string;
  hint?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("space-y-2", className)}>
      <Label htmlFor={id} className="text-xs font-medium uppercase tracking-[0.08em] text-ink-2">
        {label}
      </Label>
      {children}
      {hint ? <p className="text-xs text-ink-3">{hint}</p> : null}
    </div>
  );
}

const HOSTNAME_RE =
  /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/i;

function isValidHostname(host: string): boolean {
  const trimmed = host.trim().toLowerCase();
  if (!trimmed || trimmed.length > 253) return false;
  return HOSTNAME_RE.test(trimmed);
}

function parseUnitInterval(raw: string, fallback: number): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return fallback;
  const n = Number.parseFloat(trimmed);
  if (!Number.isFinite(n) || n < 0 || n > 1) return null;
  return n;
}

export interface DelegationEditorProps {
  delegation: DelegationRow;
  merchants: MerchantRow[];
  agentName: string;
}

export function DelegationEditor({ delegation, merchants, agentName }: DelegationEditorProps) {
  const router = useRouter();
  const hasRequireVerified = "require_verified_merchant" in delegation;
  const [maxDollars, setMaxDollars] = useState(centsToDollars(delegation.max_amount_cents));
  const [dailyDollars, setDailyDollars] = useState(centsToDollars(delegation.daily_limit_cents));
  const [approvalDollars, setApprovalDollars] = useState(
    centsToDollars(delegation.approval_threshold_cents),
  );
  const [allowRecurring, setAllowRecurring] = useState(delegation.allow_recurring);
  const [allowedMerchants, setAllowedMerchants] = useState<string[]>(delegation.allowed_merchants);
  const [active, setActive] = useState(delegation.status === "active");
  const [minTrustScore, setMinTrustScore] = useState(String(delegation.min_trust_score ?? 95));
  const [trustedDomains, setTrustedDomains] = useState<string[]>(
    delegation.trusted_domain_overrides ?? [],
  );
  const [allowedDomains, setAllowedDomains] = useState<string[]>(delegation.allowed_domains ?? []);
  const [domainDraft, setDomainDraft] = useState("");
  const [allowedDomainDraft, setAllowedDomainDraft] = useState("");
  const [priceDeny, setPriceDeny] = useState(
    String(delegation.price_anomaly_deny_threshold ?? 0.8),
  );
  const [priceReview, setPriceReview] = useState(
    String(delegation.price_anomaly_review_threshold ?? 0.5),
  );
  const [injectionKill, setInjectionKill] = useState(
    String(delegation.injection_kill_threshold ?? 0.9),
  );
  const [killSwitchEnabled, setKillSwitchEnabled] = useState(delegation.kill_switch_enabled ?? true);
  const [requireVerifiedMerchant, setRequireVerifiedMerchant] = useState(
    delegation.require_verified_merchant ?? false,
  );
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  const maxCents = dollarsToCents(maxDollars) ?? delegation.max_amount_cents;
  const dailyCents = dollarsToCents(dailyDollars) ?? delegation.daily_limit_cents;
  const approvalCents = dollarsToCents(approvalDollars) ?? delegation.approval_threshold_cents;
  const minTrustParsed = Number.parseInt(minTrustScore, 10);
  const minTrustEffective =
    Number.isFinite(minTrustParsed) && minTrustParsed >= 0 && minTrustParsed <= 100
      ? minTrustParsed
      : delegation.min_trust_score ?? 95;

  const statement = useMemo(
    () => buildStatement(allowRecurring, allowedMerchants, merchants, active),
    [allowRecurring, allowedMerchants, merchants, active],
  );

  function addDomain() {
    const host = domainDraft.trim().toLowerCase();
    if (!host) return;
    if (!isValidHostname(host)) {
      setFeedback({ tone: "error", text: "Enter a valid hostname (e.g. acme-api.dev)." });
      return;
    }
    if (trustedDomains.includes(host)) {
      setDomainDraft("");
      return;
    }
    setTrustedDomains((prev) => [...prev, host].sort());
    setDomainDraft("");
    setFeedback(null);
  }

  function removeDomain(host: string) {
    setTrustedDomains((prev) => prev.filter((d) => d !== host));
  }

  function authorizeDomainFromTrust(domain: string) {
    const host = domain.trim().toLowerCase();
    if (!host) return;
    if (trustedDomains.includes(host)) return;
    setTrustedDomains((prev) => [...prev, host].sort());
    setFeedback(null);
  }

  function addAllowedDomain() {
    const host = allowedDomainDraft.trim().toLowerCase();
    if (!host) return;
    if (!isValidHostname(host)) {
      setFeedback({ tone: "error", text: "Enter a valid hostname (e.g. acme-api.dev)." });
      return;
    }
    if (allowedDomains.includes(host)) {
      setAllowedDomainDraft("");
      return;
    }
    setAllowedDomains((prev) => [...prev, host].sort());
    setAllowedDomainDraft("");
    setFeedback(null);
  }

  function removeAllowedDomain(host: string) {
    setAllowedDomains((prev) => prev.filter((d) => d !== host));
  }

  function quickAddMerchantDomain(domain: string) {
    const host = domain.trim().toLowerCase();
    if (!host || !isValidHostname(host)) return;
    if (allowedDomains.includes(host)) return;
    setAllowedDomains((prev) => [...prev, host].sort());
    setFeedback(null);
  }

  const merchantDomainsForQuickAdd = useMemo(
    () =>
      merchants
        .map((m) => ({ slug: m.slug, name: m.name, domain: m.domain?.trim().toLowerCase() ?? "" }))
        .filter((m) => m.domain && isValidHostname(m.domain)),
    [merchants],
  );

  function toggleMerchant(slug: string, checked: boolean) {
    setAllowedMerchants((prev) =>
      checked ? [...prev, slug].sort() : prev.filter((s) => s !== slug),
    );
  }

  async function save() {
    setFeedback(null);
    const max_amount_cents = dollarsToCents(maxDollars);
    const daily_limit_cents = dollarsToCents(dailyDollars);
    const approval_threshold_cents = dollarsToCents(approvalDollars);
    if (
      max_amount_cents === null ||
      daily_limit_cents === null ||
      approval_threshold_cents === null
    ) {
      setFeedback({ tone: "error", text: "Enter valid dollar amounts." });
      return;
    }
    if (daily_limit_cents < max_amount_cents) {
      setFeedback({
        tone: "error",
        text: "Daily limit must be at least the per-transaction maximum.",
      });
      return;
    }

    const min_trust_score = Number.parseInt(minTrustScore, 10);
    if (!Number.isFinite(min_trust_score) || min_trust_score < 0 || min_trust_score > 100) {
      setFeedback({ tone: "error", text: "Minimum trust score must be 0–100." });
      return;
    }
    const price_anomaly_deny_threshold = parseUnitInterval(priceDeny, 0.8);
    const price_anomaly_review_threshold = parseUnitInterval(priceReview, 0.5);
    const injection_kill_threshold = parseUnitInterval(injectionKill, 0.9);
    if (
      price_anomaly_deny_threshold === null ||
      price_anomaly_review_threshold === null ||
      injection_kill_threshold === null
    ) {
      setFeedback({ tone: "error", text: "Guardrail thresholds must be numbers between 0 and 1." });
      return;
    }
    if (price_anomaly_review_threshold > price_anomaly_deny_threshold) {
      setFeedback({
        tone: "error",
        text: "Price anomaly review threshold must be at most the deny threshold.",
      });
      return;
    }

    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        delegation_id: delegation.id,
        max_amount_cents,
        daily_limit_cents,
        approval_threshold_cents,
        allow_recurring: allowRecurring,
        allowed_merchants: allowedMerchants,
        status: active ? "active" : "disabled",
        min_trust_score,
        trusted_domain_overrides: trustedDomains,
        allowed_domains: allowedDomains,
        price_anomaly_deny_threshold,
        price_anomaly_review_threshold,
        injection_kill_threshold,
        kill_switch_enabled: killSwitchEnabled,
      };
      if (hasRequireVerified) {
        payload.require_verified_merchant = requireVerifiedMerchant;
      }
      const res = await fetch("/api/delegations", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = (await res.json()) as { message?: string; error?: string };
      if (!res.ok) {
        setFeedback({
          tone: "error",
          text: body.message ?? body.error ?? "Could not save delegation.",
        });
        return;
      }
      setFeedback({ tone: "success", text: "Delegation saved." });
      router.refresh();
    } catch {
      setFeedback({ tone: "error", text: "Network error. Try again." });
    } finally {
      setSaving(false);
    }
  }

  const inputClass = "h-11 bg-surface font-mono text-[15px] tabular-nums";

  return (
    <div className="space-y-6">
      <section className="rounded-[6px] border border-line bg-surface px-6 py-10 sm:px-10 sm:py-14">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <Eyebrow>Policy in plain words</Eyebrow>
          <span
            className={cn(
              "inline-flex items-center rounded-[4px] px-2 py-1 text-[11px] font-semibold uppercase tracking-[0.08em]",
              active ? "bg-executed-bg text-executed" : "bg-blocked-bg text-blocked",
            )}
          >
            {active ? "Delegation active" : "Delegation disabled"}
          </span>
        </div>
        {statement.active ? (
          <p className="font-display text-4xl font-semibold leading-[0.98] tracking-[-0.045em] text-ink sm:text-5xl lg:text-6xl">
            {agentName} can spend up to <Num>{formatCents(maxCents)}</Num> per purchase and{" "}
            <Num>{formatCents(dailyCents)}</Num> a day on {statement.recurringPhrase} from{" "}
            <span className="text-accent">{statement.merchantPhrase}</span>.
          </p>
        ) : (
          <p className="font-display text-4xl font-semibold leading-[0.98] tracking-[-0.045em] text-ink sm:text-5xl lg:text-6xl">
            {agentName} delegation is <span className="text-blocked">disabled</span> — no purchases
            can be authorized.
          </p>
        )}
        {statement.active ? (
          <p className="mt-8 max-w-3xl text-base leading-relaxed text-ink-2">
            {approvalCents > 0 ? (
              <>
                Purchases above <Num>{formatCents(approvalCents)}</Num> require your approval.
              </>
            ) : (
              <>Purchases do not require human approval.</>
            )}{" "}
            Only websites with trust ≥ <Num>{minTrustEffective}</Num> (or authorized by you). Jev
            screens listings for injection and price anomalies; injection triggers the kill switch.
          </p>
        ) : null}
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <Section
          eyebrow="Limits"
          title="Spending limits"
          description={`Hard ceilings for ${agentName}. Policy uses these — not what the model claims.`}
        >
          <div className="grid gap-5 sm:grid-cols-2">
            <Field id="max-tx" label="Maximum transaction ($)">
              <Input
                id="max-tx"
                type="text"
                inputMode="decimal"
                className={inputClass}
                value={maxDollars}
                onChange={(e) => setMaxDollars(e.target.value)}
              />
            </Field>
            <Field id="daily-limit" label="Daily spending limit ($)">
              <Input
                id="daily-limit"
                type="text"
                inputMode="decimal"
                className={inputClass}
                value={dailyDollars}
                onChange={(e) => setDailyDollars(e.target.value)}
              />
            </Field>
            <Field
              id="approval-threshold"
              label="Require approval above ($)"
              className="sm:col-span-2"
            >
              <Input
                id="approval-threshold"
                type="text"
                inputMode="decimal"
                className={inputClass}
                value={approvalDollars}
                onChange={(e) => setApprovalDollars(e.target.value)}
              />
            </Field>
          </div>
        </Section>

        <Section eyebrow="Status" title="Delegation" description={`Agent: ${agentName}`}>
          <div>
            <ToggleRow
              id="active"
              label="Active"
              hint="When off, all agent purchases are denied"
              checked={active}
              onCheckedChange={setActive}
              ariaLabel="Delegation active"
            />
            <ToggleRow
              id="recurring"
              label="Subscriptions"
              hint="Allow recurring merchant plans"
              checked={allowRecurring}
              onCheckedChange={setAllowRecurring}
              ariaLabel="Allow subscriptions"
            />
          </div>
        </Section>

        <Section
          eyebrow="Guardrails"
          title="Website trust"
          description="Deterministic checks on merchant trust before policy limits apply."
        >
          <div className="space-y-5">
            <Field
              id="min-trust"
              label="Minimum website trust score"
              hint="ScamAdvisor-style trust score; unscored sites are denied."
            >
              <Input
                id="min-trust"
                type="number"
                min={0}
                max={100}
                className={inputClass}
                value={minTrustScore}
                onChange={(e) => setMinTrustScore(e.target.value)}
              />
            </Field>

            <WebsiteTrustCheck
              minTrustScore={minTrustEffective}
              onAuthorize={authorizeDomainFromTrust}
            />

            <p className="text-sm text-ink-2">
              Live ScamAdviser trust score. Sites below your minimum are denied unless you
              authorize them.
            </p>

            <Field id="domain-override" label="Human-authorized websites">
              {trustedDomains.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {trustedDomains.map((host) => (
                    <span
                      key={host}
                      className="inline-flex items-center gap-1 rounded-[4px] bg-accent-wash py-1 pl-2 pr-1 font-mono text-xs text-accent"
                    >
                      {host}
                      <button
                        type="button"
                        className="rounded-[3px] p-0.5 text-accent/70 hover:bg-accent-soft hover:text-accent"
                        aria-label={`Remove ${host}`}
                        onClick={() => removeDomain(host)}
                      >
                        <X className="size-3" />
                      </button>
                    </span>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-ink-3">No overrides — trust score alone decides.</p>
              )}
              <div className="flex gap-2">
                <Input
                  id="domain-override"
                  placeholder="merchant.example.com"
                  className="h-11 bg-surface font-mono text-sm"
                  value={domainDraft}
                  onChange={(e) => setDomainDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addDomain();
                    }
                  }}
                />
                <button
                  type="button"
                  onClick={addDomain}
                  className="h-11 shrink-0 rounded-[4px] border border-line bg-surface px-4 text-sm font-medium text-ink transition-colors hover:border-ink"
                >
                  Add domain
                </button>
              </div>
            </Field>

            {hasRequireVerified ? (
              <div className="border-t border-line pt-5">
                <ToggleRow
                  id="require-verified"
                  label="Require verified merchant"
                  hint="Deny proposals from merchants not marked verified in the registry"
                  checked={requireVerifiedMerchant}
                  onCheckedChange={setRequireVerifiedMerchant}
                  ariaLabel="Require verified merchant"
                />
              </div>
            ) : null}
          </div>
        </Section>

        <Section
          eyebrow="Jev"
          title="Listing risk"
          description="Jev scores each listing 0–1 for price anomalies and prompt injection."
        >
          <div className="grid gap-5 sm:grid-cols-2">
            <Field id="price-deny" label="Price anomaly: deny ≥">
              <Input
                id="price-deny"
                type="text"
                inputMode="decimal"
                className={inputClass}
                value={priceDeny}
                onChange={(e) => setPriceDeny(e.target.value)}
              />
            </Field>
            <Field id="price-review" label="Price anomaly: review ≥">
              <Input
                id="price-review"
                type="text"
                inputMode="decimal"
                className={inputClass}
                value={priceReview}
                onChange={(e) => setPriceReview(e.target.value)}
              />
            </Field>
            <Field
              id="injection-kill"
              label="Prompt-injection kill threshold"
              className="sm:col-span-2"
            >
              <Input
                id="injection-kill"
                type="text"
                inputMode="decimal"
                className={inputClass}
                value={injectionKill}
                onChange={(e) => setInjectionKill(e.target.value)}
              />
            </Field>
          </div>
          <div
            className={cn(
              "mt-6 flex items-center justify-between gap-4 rounded-[6px] p-4",
              killSwitchEnabled ? "bg-inverse text-white" : "border border-line bg-canvas",
            )}
          >
            <div className="flex items-start gap-3">
              <ShieldAlert
                className={cn(
                  "mt-0.5 size-5 shrink-0",
                  killSwitchEnabled ? "text-blocked" : "text-ink-3",
                )}
              />
              <div className="space-y-1">
                <Label
                  htmlFor="kill-switch"
                  className={cn(
                    "text-[15px] font-medium",
                    killSwitchEnabled ? "text-white" : "text-ink",
                  )}
                >
                  Kill switch enabled
                </Label>
                <p className={cn("text-xs", killSwitchEnabled ? "text-white/60" : "text-ink-3")}>
                  Suspends the agent when injection or crypto exfiltration signals exceed threshold
                </p>
              </div>
            </div>
            <Switch
              id="kill-switch"
              checked={killSwitchEnabled}
              onCheckedChange={setKillSwitchEnabled}
              aria-label="Kill switch enabled"
            />
          </div>
        </Section>
      </div>

        <Section
          eyebrow="Websites"
          title="Allowed websites"
          description="Leave empty to allow any website that passes the trust and merchant rules. If set, agents can only buy from these websites."
        >
          <div className="space-y-4">
            {allowedDomains.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {allowedDomains.map((host) => (
                  <span
                    key={host}
                    className="inline-flex items-center gap-1 rounded-[4px] bg-accent-wash py-1 pl-2 pr-1 font-mono text-xs text-accent"
                  >
                    {host}
                    <button
                      type="button"
                      className="rounded-[3px] p-0.5 text-accent/70 hover:bg-accent-soft hover:text-accent"
                      aria-label={`Remove ${host}`}
                      onClick={() => removeAllowedDomain(host)}
                    >
                      <X className="size-3" />
                    </button>
                  </span>
                ))}
              </div>
            ) : (
              <p className="text-xs text-ink-3">No website restriction — trust and merchant rules apply.</p>
            )}
            <div className="flex gap-2">
              <Input
                id="allowed-domain"
                placeholder="merchant.example.com"
                className="h-11 bg-surface font-mono text-sm"
                value={allowedDomainDraft}
                onChange={(e) => setAllowedDomainDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addAllowedDomain();
                  }
                }}
              />
              <button
                type="button"
                onClick={addAllowedDomain}
                className="h-11 shrink-0 rounded-[4px] border border-line bg-surface px-4 text-sm font-medium text-ink transition-colors hover:border-ink"
              >
                Add domain
              </button>
            </div>
            {merchantDomainsForQuickAdd.length > 0 ? (
              <div className="space-y-2 border-t border-line pt-4">
                <p className="text-xs font-medium uppercase tracking-[0.08em] text-ink-2">
                  Quick add from catalog
                </p>
                <div className="flex flex-wrap gap-2">
                  {merchantDomainsForQuickAdd.map((m) => (
                    <button
                      key={m.slug}
                      type="button"
                      disabled={allowedDomains.includes(m.domain)}
                      onClick={() => quickAddMerchantDomain(m.domain)}
                      className={cn(
                        "rounded-[4px] border border-line px-3 py-1.5 text-left text-xs transition-colors",
                        allowedDomains.includes(m.domain)
                          ? "cursor-not-allowed bg-canvas text-ink-3"
                          : "bg-surface text-ink hover:border-accent hover:text-accent",
                      )}
                    >
                      <span className="font-medium">{m.name}</span>
                      <span className="mt-0.5 block font-mono text-[11px] text-ink-3">{m.domain}</span>
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        </Section>

        <Section
          eyebrow="Allowlist"
          title="Allowed merchants"
          description={`${allowedMerchants.length} of ${merchants.length} selected. Sites must also clear trust ≥ ${minTrustEffective}.`}
        >
        <ul className="grid grid-cols-2 gap-px overflow-hidden rounded-[6px] border border-line bg-line sm:grid-cols-3 lg:grid-cols-4">
          {merchants.map((m) => {
            const checked = allowedMerchants.includes(m.slug);
            return (
              <li key={m.id} className="bg-surface">
                <button
                  type="button"
                  role="checkbox"
                  id={`merchant-${m.slug}`}
                  aria-checked={checked}
                  aria-label={`Allow ${m.name}`}
                  onClick={() => toggleMerchant(m.slug, !checked)}
                  className={cn(
                    "group relative flex h-full min-h-32 w-full flex-col justify-between gap-4 p-5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent",
                    checked ? "bg-accent-wash" : "hover:bg-canvas",
                  )}
                >
                  <span
                    aria-hidden
                    className={cn(
                      "absolute right-4 top-4 inline-flex size-5 items-center justify-center rounded-[4px] border transition-colors",
                      checked ? "border-accent bg-accent text-white" : "border-line bg-surface",
                    )}
                  >
                    {checked ? <Check className="size-3.5" /> : null}
                  </span>
                  <span className="space-y-1 pr-8">
                    <span
                      className={cn(
                        "block font-display text-xl font-semibold leading-none tracking-[-0.03em] transition-colors",
                        checked ? "text-ink" : "text-ink-3 group-hover:text-ink-2",
                      )}
                    >
                      {m.name}
                    </span>
                    <span className="block font-mono text-xs text-ink-3">{m.slug}</span>
                    {m.trust_score != null ? (
                      <span className="mt-2 flex flex-wrap items-center gap-1.5">
                        <span className="font-mono text-[11px] text-ink-2">trust {m.trust_score}</span>
                        <span className="rounded-[4px] bg-[#F2F2F2] px-1.5 py-0.5 text-[10px] text-ink-3">
                          {merchantTrustSourceLabel(m.trust_score_source)}
                        </span>
                      </span>
                    ) : null}
                  </span>
                  <div className="flex flex-wrap gap-1.5">
                  {m.verified ? (
                    <span className="inline-flex w-fit items-center gap-1 rounded-[4px] bg-executed-bg px-2 py-0.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-executed">
                      <BadgeCheck className="size-3" />
                      Verified
                    </span>
                  ) : null}
                  {m.trusted ? (
                    <span className="inline-flex w-fit items-center gap-1 rounded-[4px] bg-approved-bg px-2 py-0.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-approved">
                      <BadgeCheck className="size-3" />
                      Trusted
                    </span>
                  ) : (
                    <span className="inline-flex w-fit items-center rounded-[4px] bg-waiting-bg px-2 py-0.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-waiting">
                      Untrusted
                    </span>
                  )}
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      </Section>

      <div className="flex flex-wrap items-center gap-4 rounded-[6px] border border-line bg-surface p-6">
        <ArrowButton type="button" disabled={saving} onClick={() => void save()}>
          {saving ? <Loader2 className="size-4 animate-spin" /> : null}
          Save delegation
        </ArrowButton>
        {feedback ? (
          <p
            className={cn(
              "text-sm font-medium",
              feedback.tone === "success" ? "text-executed" : "text-blocked",
            )}
          >
            {feedback.text}
          </p>
        ) : (
          <p className="text-sm text-ink-3">The statement above previews your edits before you save.</p>
        )}
      </div>
    </div>
  );
}

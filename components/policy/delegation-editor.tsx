"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import type { DelegationRow, MerchantRow } from "@/lib/data/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { formatCents, cn } from "@/lib/utils";

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

function buildSummary(
  agentName: string,
  maxCents: number,
  dailyCents: number,
  approvalCents: number,
  allowRecurring: boolean,
  allowedSlugs: string[],
  merchants: MerchantRow[],
  active: boolean,
  minTrustScore: number,
): string {
  if (!active) {
    return `${agentName} delegation is disabled — no purchases can be authorized.`;
  }
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
  const approvalPhrase =
    approvalCents > 0
      ? ` Purchases above ${formatCents(approvalCents)} require approval.`
      : " Purchases do not require human approval.";
  const guardrailPhrase = ` Only websites with trust ≥ ${minTrustScore} (or authorized by you). Jev screens listings for injection and price anomalies; injection triggers the kill switch.`;
  return `${agentName} can make ${recurringPhrase} from ${merchantPhrase} up to ${formatCents(maxCents)} per transaction and ${formatCents(dailyCents)}/day.${approvalPhrase}${guardrailPhrase}`;
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
  const [domainDraft, setDomainDraft] = useState("");
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

  const summary = useMemo(
    () =>
      buildSummary(
        agentName,
        maxCents,
        dailyCents,
        approvalCents,
        allowRecurring,
        allowedMerchants,
        merchants,
        active,
        minTrustEffective,
      ),
    [
      agentName,
      maxCents,
      dailyCents,
      approvalCents,
      allowRecurring,
      allowedMerchants,
      merchants,
      active,
      minTrustEffective,
    ],
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

  return (
    <div className="space-y-8">
      <p className="rounded-md border border-border bg-muted/30 px-4 py-3 text-sm leading-relaxed text-foreground/90">
        {summary}
      </p>

      <div className="grid gap-6 sm:grid-cols-2">
        <div className="space-y-2 sm:col-span-2">
          <Label>Agent</Label>
          <p className="text-sm font-medium">{agentName}</p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="max-tx">Maximum transaction ($)</Label>
          <Input
            id="max-tx"
            type="text"
            inputMode="decimal"
            value={maxDollars}
            onChange={(e) => setMaxDollars(e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="daily-limit">Daily spending limit ($)</Label>
          <Input
            id="daily-limit"
            type="text"
            inputMode="decimal"
            value={dailyDollars}
            onChange={(e) => setDailyDollars(e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="approval-threshold">Require approval above ($)</Label>
          <Input
            id="approval-threshold"
            type="text"
            inputMode="decimal"
            value={approvalDollars}
            onChange={(e) => setApprovalDollars(e.target.value)}
          />
        </div>

        <div className="flex items-center justify-between rounded-md border border-border px-4 py-3 sm:col-span-2">
          <div>
            <Label htmlFor="recurring">Subscriptions</Label>
            <p className="text-xs text-muted-foreground">Allow recurring merchant plans</p>
          </div>
          <Switch
            id="recurring"
            checked={allowRecurring}
            onCheckedChange={setAllowRecurring}
            aria-label="Allow subscriptions"
          />
        </div>

        <div className="flex items-center justify-between rounded-md border border-border px-4 py-3 sm:col-span-2">
          <div>
            <Label htmlFor="active">Active</Label>
            <p className="text-xs text-muted-foreground">When off, all agent purchases are denied</p>
          </div>
          <Switch
            id="active"
            checked={active}
            onCheckedChange={setActive}
            aria-label="Delegation active"
          />
        </div>
      </div>

      <div className="space-y-4 rounded-lg border border-border p-4">
        <div>
          <h2 className="text-sm font-semibold tracking-tight">Guardrails</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Deterministic checks on merchant trust and listing risk before policy limits apply.
          </p>
        </div>

        <div className="grid gap-6 sm:grid-cols-2">
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="min-trust">Minimum website trust score</Label>
            <Input
              id="min-trust"
              type="number"
              min={0}
              max={100}
              value={minTrustScore}
              onChange={(e) => setMinTrustScore(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              ScamAdvisor-style trust score; unscored sites are denied.
            </p>
          </div>

          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="domain-override">Human-authorized websites</Label>
            <div className="flex flex-wrap gap-2">
              {trustedDomains.map((host) => (
                <Badge key={host} variant="sky" className="gap-1 font-mono normal-case tracking-normal">
                  {host}
                  <button
                    type="button"
                    className="ml-1 rounded px-0.5 text-sky-200/80 hover:text-foreground"
                    aria-label={`Remove ${host}`}
                    onClick={() => removeDomain(host)}
                  >
                    ×
                  </button>
                </Badge>
              ))}
            </div>
            <div className="flex gap-2">
              <Input
                id="domain-override"
                placeholder="merchant.example.com"
                value={domainDraft}
                onChange={(e) => setDomainDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addDomain();
                  }
                }}
              />
              <Button type="button" variant="outline" onClick={addDomain}>
                Add domain
              </Button>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="price-deny">Price anomaly: deny ≥</Label>
            <Input
              id="price-deny"
              type="text"
              inputMode="decimal"
              value={priceDeny}
              onChange={(e) => setPriceDeny(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="price-review">Price anomaly: review ≥</Label>
            <Input
              id="price-review"
              type="text"
              inputMode="decimal"
              value={priceReview}
              onChange={(e) => setPriceReview(e.target.value)}
            />
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="injection-kill">Prompt-injection kill threshold</Label>
            <Input
              id="injection-kill"
              type="text"
              inputMode="decimal"
              value={injectionKill}
              onChange={(e) => setInjectionKill(e.target.value)}
            />
          </div>

          <div className="flex items-center justify-between rounded-md border border-border px-4 py-3 sm:col-span-2">
            <div>
              <Label htmlFor="kill-switch">Kill switch enabled</Label>
              <p className="text-xs text-muted-foreground">
                Suspends the agent when injection or crypto exfiltration signals exceed threshold
              </p>
            </div>
            <Switch
              id="kill-switch"
              checked={killSwitchEnabled}
              onCheckedChange={setKillSwitchEnabled}
              aria-label="Kill switch enabled"
            />
          </div>

          {hasRequireVerified ? (
            <div className="flex items-center justify-between rounded-md border border-border px-4 py-3 sm:col-span-2">
              <div>
                <Label htmlFor="require-verified">Require verified merchant</Label>
                <p className="text-xs text-muted-foreground">
                  Deny proposals from merchants not marked verified in the registry
                </p>
              </div>
              <Switch
                id="require-verified"
                checked={requireVerifiedMerchant}
                onCheckedChange={setRequireVerifiedMerchant}
                aria-label="Require verified merchant"
              />
            </div>
          ) : null}
        </div>
      </div>

      <div className="space-y-3">
        <Label>Allowed merchants</Label>
        <ul className="space-y-2 rounded-md border border-border p-3">
          {merchants.map((m) => {
            const checked = allowedMerchants.includes(m.slug);
            return (
              <li key={m.id} className="flex items-center gap-3">
                <Checkbox
                  id={`merchant-${m.slug}`}
                  checked={checked}
                  onCheckedChange={(c) => toggleMerchant(m.slug, c)}
                  aria-label={`Allow ${m.name}`}
                />
                <label
                  htmlFor={`merchant-${m.slug}`}
                  className="flex flex-1 cursor-pointer items-center gap-2 text-sm"
                >
                  <span>{m.name}</span>
                  <span className="font-mono text-xs text-muted-foreground">{m.slug}</span>
                  {!m.trusted ? (
                    <Badge variant="amber" className="normal-case tracking-normal">
                      untrusted
                    </Badge>
                  ) : null}
                </label>
              </li>
            );
          })}
        </ul>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" disabled={saving} onClick={() => void save()}>
          {saving ? <Loader2 className="size-4 animate-spin" /> : null}
          Save delegation
        </Button>
        {feedback ? (
          <p
            className={cn(
              "text-sm",
              feedback.tone === "success" ? "text-emerald-400" : "text-red-400",
            )}
          >
            {feedback.text}
          </p>
        ) : null}
      </div>
    </div>
  );
}

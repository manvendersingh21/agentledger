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
  return `${agentName} can make ${recurringPhrase} from ${merchantPhrase} up to ${formatCents(maxCents)} per transaction and ${formatCents(dailyCents)}/day.${approvalPhrase}`;
}

export interface DelegationEditorProps {
  delegation: DelegationRow;
  merchants: MerchantRow[];
  agentName: string;
}

export function DelegationEditor({ delegation, merchants, agentName }: DelegationEditorProps) {
  const router = useRouter();
  const [maxDollars, setMaxDollars] = useState(centsToDollars(delegation.max_amount_cents));
  const [dailyDollars, setDailyDollars] = useState(centsToDollars(delegation.daily_limit_cents));
  const [approvalDollars, setApprovalDollars] = useState(
    centsToDollars(delegation.approval_threshold_cents),
  );
  const [allowRecurring, setAllowRecurring] = useState(delegation.allow_recurring);
  const [allowedMerchants, setAllowedMerchants] = useState<string[]>(delegation.allowed_merchants);
  const [active, setActive] = useState(delegation.status === "active");
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  const maxCents = dollarsToCents(maxDollars) ?? delegation.max_amount_cents;
  const dailyCents = dollarsToCents(dailyDollars) ?? delegation.daily_limit_cents;
  const approvalCents = dollarsToCents(approvalDollars) ?? delegation.approval_threshold_cents;

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
      ),
    [agentName, maxCents, dailyCents, approvalCents, allowRecurring, allowedMerchants, merchants, active],
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

    setSaving(true);
    try {
      const res = await fetch("/api/delegations", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          delegation_id: delegation.id,
          max_amount_cents,
          daily_limit_cents,
          approval_threshold_cents,
          allow_recurring: allowRecurring,
          allowed_merchants: allowedMerchants,
          status: active ? "active" : "disabled",
        }),
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

"use client";

import { useState } from "react";
import { Loader2, ShieldCheck, ShieldX } from "lucide-react";
import { ArrowButton } from "@/components/brand/arrow-button";
import { Eyebrow } from "@/components/brand/eyebrow";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

interface TrustPayload {
  domain: string;
  score: number | null;
  source: string;
  checkedAt: string;
}

export interface WebsiteTrustCheckProps {
  minTrustScore?: number;
  onAuthorize: (domain: string) => void;
  initialDomain?: string;
  className?: string;
}

export function WebsiteTrustCheck({
  minTrustScore = 95,
  onAuthorize,
  initialDomain = "",
  className,
}: WebsiteTrustCheckProps) {
  const [domainInput, setDomainInput] = useState(initialDomain);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [trust, setTrust] = useState<TrustPayload | null>(null);

  async function runCheck() {
    const domain = domainInput.trim();
    if (!domain) {
      setError("Enter a website hostname.");
      setTrust(null);
      return;
    }

    setLoading(true);
    setError(null);
    setTrust(null);

    try {
      const response = await fetch("/api/trust/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ domain }),
      });
      const body = (await response.json()) as { trust?: TrustPayload; message?: string; error?: string };
      if (!response.ok) {
        setError(body.message ?? "Trust check failed.");
        return;
      }
      if (body.trust) {
        setTrust(body.trust);
        setDomainInput(body.trust.domain);
      }
    } catch {
      setError("Could not reach the trust check service.");
    } finally {
      setLoading(false);
    }
  }

  const passes =
    trust?.score !== null && trust?.score !== undefined && trust.score >= minTrustScore;

  return (
    <div
      className={cn(
        "rounded-[6px] border border-line bg-surface p-6 sm:p-8",
        className,
      )}
    >
      <div className="mb-6 space-y-2">
        <Eyebrow>Trust</Eyebrow>
        <h3 className="font-display text-2xl font-semibold leading-[0.95] tracking-[-0.045em] text-ink">
          Check website trust score
        </h3>
        <p className="text-sm text-ink-2">
          Live ScamAdviser signal before you authorize a domain override (minimum{" "}
          <span className="font-mono tabular-nums text-accent">{minTrustScore}</span>).
        </p>
      </div>

      <div className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="trust-domain" className="text-ink">
            Website hostname
          </Label>
          <Input
            id="trust-domain"
            placeholder="merchant.example.com"
            className="h-11 bg-surface font-mono text-sm"
            value={domainInput}
            onChange={(e) => setDomainInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void runCheck();
              }
            }}
          />
        </div>

        <ArrowButton
          type="button"
          variant="secondary"
          disabled={loading}
          onClick={() => void runCheck()}
        >
          {loading ? (
            <>
              <Loader2 className="mr-2 size-4 animate-spin" aria-hidden />
              Checking…
            </>
          ) : (
            "Check trust score"
          )}
        </ArrowButton>

        {error ? (
          <p className="text-sm text-blocked" role="alert">
            {error}
          </p>
        ) : null}

        {trust ? (
          <div
            className={cn(
              "mt-2 rounded-[6px] border p-6",
              passes ? "border-line bg-accent-wash" : "border-blocked/30 bg-blocked-bg",
            )}
          >
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <p className="font-mono text-xs uppercase tracking-wider text-ink-3">
                  {trust.domain}
                </p>
                <p
                  className="font-display text-6xl font-semibold leading-none tracking-[-0.045em] text-ink"
                  aria-live="polite"
                >
                  {trust.score === null ? "—" : trust.score}
                </p>
              </div>
              <div
                className={cn(
                  "inline-flex items-center gap-2 rounded-[4px] px-3 py-2 text-[11px] font-medium uppercase tracking-wider",
                  passes ? "bg-approved-bg text-approved" : "bg-blocked-bg text-blocked",
                )}
              >
                {passes ? (
                  <>
                    <ShieldCheck className="size-4" aria-hidden />
                    Pass
                  </>
                ) : (
                  <>
                    <ShieldX className="size-4" aria-hidden />
                    Below minimum
                  </>
                )}
              </div>
            </div>
            <p className="mt-3 text-xs text-ink-3">
              Source: {trust.source === "scamadvisor" ? "ScamAdviser" : "unavailable"}
            </p>
            {passes ? (
              <div className="mt-6">
                <ArrowButton
                  type="button"
                  onClick={() => onAuthorize(trust.domain)}
                >
                  Authorize website
                </ArrowButton>
              </div>
            ) : (
              <p className="mt-4 text-sm text-ink-2">
                Score is below your minimum ({minTrustScore}). Fix the site or lower the threshold before
                authorizing.
              </p>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}

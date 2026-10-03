"use client";

import { useCallback, useState } from "react";
import { Check, RefreshCw, ShieldX } from "lucide-react";
import type { AuditVerification } from "@/lib/data/types";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface IntegrityBadgeProps {
  valid: boolean;
  verifiedCount: number;
  brokenAt?: string;
  reason?: string;
  className?: string;
  compact?: boolean;
}

export function IntegrityBadge({
  valid,
  verifiedCount,
  brokenAt,
  reason,
  className,
  compact = false,
}: IntegrityBadgeProps) {
  if (!valid) {
    return (
      <div
        className={cn(
          "inline-flex flex-wrap items-center gap-3 rounded-[4px] border border-blocked bg-blocked-bg px-3.5 py-2",
          className,
        )}
        role="status"
      >
        <ShieldX className="size-4 shrink-0 text-blocked" aria-hidden />
        <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-blocked">
          Audit integrity · failure
        </span>
        {!compact && (
          <span className="font-mono text-xs text-blocked">
            {reason ?? "Hash chain broken"}
            {brokenAt ? ` · at event ${brokenAt.slice(0, 8)}…` : null}
          </span>
        )}
      </div>
    );
  }

  return (
    <div
      className={cn(
        "inline-flex flex-wrap items-center gap-3 rounded-[4px] bg-inverse px-3.5 py-2 text-white",
        className,
      )}
      role="status"
    >
      <span
        className="flex size-5 shrink-0 items-center justify-center rounded-[3px] bg-executed text-white"
        aria-hidden
      >
        <Check className="size-3.5" strokeWidth={3} />
      </span>
      <span className="text-[11px] font-semibold uppercase tracking-[0.14em]">
        Audit integrity <span className="text-[#3DDC84]">✓ Verified</span>
      </span>
      {!compact && (
        <span className="font-mono text-xs text-white/60">
          {verifiedCount.toLocaleString()} events
        </span>
      )}
    </div>
  );
}

export interface IntegrityPanelProps {
  initial: AuditVerification;
  showExplanation?: boolean;
  className?: string;
}

export function IntegrityPanel({ initial, showExplanation = true, className }: IntegrityPanelProps) {
  const [verification, setVerification] = useState(initial);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reverify = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/audit/verify", { method: "GET", credentials: "include" });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(body.message ?? `Verification failed (${res.status})`);
      }
      const data = (await res.json()) as AuditVerification;
      setVerification(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Verification failed");
    } finally {
      setLoading(false);
    }
  }, []);

  return (
    <div
      className={cn(
        "space-y-4 rounded-[6px] border border-line bg-surface p-6",
        className,
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-4">
        <IntegrityBadge {...verification} />
        <Button type="button" variant="outline" size="sm" onClick={reverify} disabled={loading}>
          <RefreshCw className={cn("size-3.5", loading && "animate-spin")} aria-hidden />
          Re-verify chain
        </Button>
      </div>
      {error ? <p className="text-xs text-blocked">{error}</p> : null}
      {showExplanation ? (
        <p className="max-w-2xl text-[15px] leading-relaxed text-ink-2">
          Every event is SHA-256 hash-linked to the previous event for your principal. Modify any
          row and verification breaks at that point.
        </p>
      ) : null}
    </div>
  );
}

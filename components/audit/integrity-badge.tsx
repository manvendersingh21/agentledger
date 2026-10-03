"use client";

import { useCallback, useState } from "react";
import { ShieldCheck, ShieldX, RefreshCw } from "lucide-react";
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
          "inline-flex flex-wrap items-center gap-2 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm",
          className,
        )}
        role="status"
      >
        <ShieldX className="size-4 shrink-0 text-red-400" aria-hidden />
        <span className="font-semibold uppercase tracking-wide text-red-400">Integrity failure</span>
        {!compact && (
          <span className="text-xs text-red-300/90">
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
        "inline-flex flex-wrap items-center gap-2 rounded-md border border-emerald-500/30 bg-emerald-500/5 px-3 py-2 text-sm",
        className,
      )}
      role="status"
    >
      <ShieldCheck className="size-4 shrink-0 text-emerald-400" aria-hidden />
      <span className="text-foreground/90">
        Audit integrity <span className="font-semibold text-emerald-400">✓ VERIFIED</span>
        <span className="text-muted-foreground"> · {verifiedCount.toLocaleString()} events</span>
      </span>
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
    <div className={cn("space-y-3", className)}>
      <div className="flex flex-wrap items-center gap-3">
        <IntegrityBadge {...verification} />
        <Button type="button" variant="outline" size="sm" onClick={reverify} disabled={loading}>
          <RefreshCw className={cn("size-3.5", loading && "animate-spin")} aria-hidden />
          Re-verify chain
        </Button>
      </div>
      {error ? <p className="text-xs text-red-400">{error}</p> : null}
      {showExplanation ? (
        <p className="max-w-2xl text-sm text-muted-foreground">
          Tamper-evident audit chain (SHA-256 hash-linked per principal). Each event includes the
          previous hash; any modification breaks verification.
        </p>
      ) : null}
    </div>
  );
}

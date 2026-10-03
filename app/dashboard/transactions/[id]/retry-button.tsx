"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { ExecuteResult } from "@/lib/domain/pipeline";
import { Button } from "@/components/ui/button";
import { formatCents } from "@/lib/utils";
import { cn } from "@/lib/utils";

export function RetryButton({ intentId }: { intentId: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ExecuteResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function simulateRetry() {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch(`/api/actions/${intentId}/execute`, {
        method: "POST",
        credentials: "include",
      });
      const body = (await res.json()) as ExecuteResult & { message?: string };
      if (!res.ok) {
        throw new Error(body.message ?? `Request failed (${res.status})`);
      }
      setResult(body);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Retry failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-3">
      <Button
        type="button"
        variant="outline"
        size="md"
        className="w-full"
        onClick={simulateRetry}
        disabled={loading}
      >
        {loading ? "Simulating…" : "Simulate retry"}
      </Button>
      {error ? <p className="text-xs text-blocked">{error}</p> : null}
      {result?.status === "duplicate" ? (
        <div
          className={cn(
            "rounded-[4px] border border-duplicate/30 bg-duplicate-bg px-3.5 py-3 text-sm text-ink",
          )}
          role="status"
        >
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-duplicate">
            Duplicate execution blocked
          </p>
          <p className="mt-1.5 text-xs text-ink-2">
            Additional charges:{" "}
            <span className="font-mono font-semibold text-ink">
              {formatCents(result.additional_charge_cents)}
            </span>
          </p>
          {result.message ? <p className="mt-1 text-xs text-ink-2">{result.message}</p> : null}
        </div>
      ) : null}
      {result && result.status !== "duplicate" ? (
        <p className="font-mono text-xs text-ink-2">Result: {result.status}</p>
      ) : null}
    </div>
  );
}

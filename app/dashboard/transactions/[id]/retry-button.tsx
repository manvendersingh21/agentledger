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
      <Button type="button" variant="outline" size="sm" onClick={simulateRetry} disabled={loading}>
        {loading ? "Simulating…" : "Simulate retry"}
      </Button>
      {error ? <p className="text-xs text-red-400">{error}</p> : null}
      {result?.status === "duplicate" ? (
        <div
          className={cn(
            "rounded-md border border-violet-500/40 bg-violet-500/10 px-3 py-2 text-sm text-violet-200",
          )}
          role="status"
        >
          <p className="font-semibold uppercase tracking-wide text-violet-400">
            Duplicate execution blocked
          </p>
          <p className="mt-1 text-xs">
            Additional charges: {formatCents(result.additional_charge_cents)}
          </p>
          {result.message ? <p className="mt-1 text-xs text-muted-foreground">{result.message}</p> : null}
        </div>
      ) : null}
      {result && result.status !== "duplicate" ? (
        <p className="text-xs text-muted-foreground">Result: {result.status}</p>
      ) : null}
    </div>
  );
}

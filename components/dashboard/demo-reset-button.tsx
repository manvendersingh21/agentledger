"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Loader2, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function DemoResetButton() {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(
    null,
  );

  async function runReset() {
    setLoading(true);
    setMessage(null);
    try {
      const res = await fetch("/api/demo/reset", { method: "POST" });
      const body = (await res.json()) as { message?: string; error?: string };
      if (!res.ok) {
        setMessage({
          tone: "error",
          text: body.message ?? body.error ?? "Reset failed.",
        });
        return;
      }
      setConfirming(false);
      setMessage({ tone: "success", text: "Demo data reset." });
      router.refresh();
    } catch {
      setMessage({ tone: "error", text: "Network error. Try again." });
    } finally {
      setLoading(false);
    }
  }

  if (!confirming) {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-10 rounded border-line bg-surface px-4 text-ink hover:border-ink hover:bg-surface"
          onClick={() => {
            setMessage(null);
            setConfirming(true);
          }}
        >
          <RotateCcw className="size-3.5" />
          Reset demo
        </Button>
        {message ? (
          <p
            className={cn(
              "text-[13px] font-medium",
              message.tone === "success" ? "text-executed" : "text-blocked",
            )}
          >
            {message.text}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <div className="max-w-xl rounded-md border border-waiting/30 bg-waiting-bg p-4">
      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-waiting">Confirm reset</p>
      <p className="mt-2 text-[14px] text-ink">
        Reset all intents, approvals, executions, and audit events for your account? Delegation
        limits return to demo defaults.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          type="button"
          variant="destructive"
          size="sm"
          disabled={loading}
          className="h-10 rounded border-inverse bg-inverse px-4 text-white hover:bg-ink"
          onClick={() => void runReset()}
        >
          {loading ? <Loader2 className="size-3.5 animate-spin" /> : null}
          Yes, reset
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={loading}
          className="h-10 rounded border border-line bg-surface px-4 text-ink hover:bg-canvas"
          onClick={() => setConfirming(false)}
        >
          Cancel
        </Button>
      </div>
      {message?.tone === "error" ? (
        <p className="mt-2 text-[13px] font-medium text-blocked">{message.text}</p>
      ) : null}
    </div>
  );
}

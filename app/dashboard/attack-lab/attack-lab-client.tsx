"use client";

import Link from "next/link";
import { useState } from "react";
import { ChevronDown, ChevronRight, Loader2, ShieldAlert } from "lucide-react";
interface AuthoritativeTerms {
  product_name: string;
  merchant: string;
  amount_cents: number;
  recurring: boolean;
}
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CodeBlock } from "@/components/ui/code-block";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { formatCents } from "@/lib/utils";

type ScenarioId = "prompt-injection" | "parameter-tampering" | "replay";

interface AttackStep {
  label: string;
  result: unknown;
}

interface AttackResponse {
  scenario: string;
  steps: AttackStep[];
  claimed?: { amount_cents: number; recurring: boolean; merchant: string };
  executions_for_intent?: number | null;
  additional_charge_cents?: number;
  message?: string;
  error?: string;
}

function intentIdFromResult(result: unknown): string | null {
  if (!result || typeof result !== "object") return null;
  const r = result as Record<string, unknown>;
  if (typeof r.intent_id === "string") return r.intent_id;
  const execution = r.execution;
  if (execution && typeof execution === "object" && typeof (execution as Record<string, unknown>).intent_id === "string") {
    return (execution as Record<string, unknown>).intent_id as string;
  }
  return null;
}

function stepPill(result: unknown): { label: string; variant: "red" | "emerald" | "violet" | "amber" | "sky" | "neutral" } {
  if (!result || typeof result !== "object") {
    return { label: "UNKNOWN", variant: "neutral" };
  }
  const r = result as Record<string, unknown>;
  const status = typeof r.status === "string" ? r.status : null;
  if (status === "denied") return { label: "BLOCKED", variant: "red" };
  if (status === "duplicate") return { label: "DUPLICATE BLOCKED", variant: "violet" };
  if (status === "executed") return { label: "EXECUTED", variant: "emerald" };
  if (status === "awaiting_approval") return { label: "AWAITING APPROVAL", variant: "amber" };
  if (status === "failed") return { label: "FAILED", variant: "red" };
  if (status === "not_executable") return { label: "NOT EXECUTABLE", variant: "neutral" };
  if (r.resolved === true && r.intent_status === "executed") {
    return { label: "EXECUTED", variant: "emerald" };
  }
  return { label: status?.toUpperCase() ?? "OK", variant: "sky" };
}

function authoritativeFromStep(steps: AttackStep[]): AuthoritativeTerms | null {
  for (const step of steps) {
    const r = step.result;
    if (!r || typeof r !== "object") continue;
    const auth = (r as Record<string, unknown>).authoritative;
    if (auth && typeof auth === "object") return auth as AuthoritativeTerms;
  }
  return null;
}

function StepRow({ step }: { step: AttackStep }) {
  const [open, setOpen] = useState(false);
  const pill = stepPill(step.result);
  const intentId = intentIdFromResult(step.result);

  return (
    <li className="rounded-md border border-border bg-muted/20">
      <button
        type="button"
        className="flex w-full items-start gap-3 px-3 py-2 text-left text-sm"
        onClick={() => setOpen((o) => !o)}
      >
        {open ? (
          <ChevronDown className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        )}
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={pill.variant}>{pill.label}</Badge>
            <span>{step.label}</span>
          </div>
          {intentId ? (
            <Link
              href={`/dashboard/transactions/${intentId}`}
              className="font-mono text-xs text-sky-400 hover:underline"
              onClick={(e) => e.stopPropagation()}
            >
              View transaction timeline →
            </Link>
          ) : null}
        </div>
      </button>
      {open ? (
        <div className="border-t border-border p-3">
          <CodeBlock value={step.result} title="Raw response" />
        </div>
      ) : null}
    </li>
  );
}

export function AttackLabClient() {
  const [loading, setLoading] = useState<ScenarioId | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [last, setLast] = useState<AttackResponse | null>(null);

  async function runScenario(scenario: ScenarioId) {
    setLoading(scenario);
    setError(null);
    try {
      const res = await fetch(`/api/attack/${scenario}`, { method: "POST" });
      const body = (await res.json()) as AttackResponse;
      if (!res.ok) {
        setError(body.message ?? body.error ?? "Attack scenario failed.");
        return;
      }
      setLast(body);
    } catch {
      setError("Network error. Try again.");
    } finally {
      setLoading(null);
    }
  }

  const auth = last ? authoritativeFromStep(last.steps) : null;
  const replaySummary = last?.scenario === "replay" ? summarizeReplay(last) : null;

  return (
    <div className="space-y-6">
      {error ? (
        <p className="rounded-md border border-red-500/30 bg-red-500/5 px-4 py-3 text-sm text-red-400">
          {error}
        </p>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <ShieldAlert className="size-4 text-red-400" />
              Prompt injection
            </CardTitle>
            <CardDescription>
              Malicious merchant listing tries to override purchase policy. Expect BLOCKED.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              disabled={loading !== null}
              onClick={() => void runScenario("prompt-injection")}
            >
              {loading === "prompt-injection" ? <Loader2 className="size-4 animate-spin" /> : null}
              Run scenario
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Parameter tampering</CardTitle>
            <CardDescription>
              Agent claims $5 one-time from acme-api for Evil Cloud; server uses authoritative
              $500 recurring terms.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              disabled={loading !== null}
              onClick={() => void runScenario("parameter-tampering")}
            >
              {loading === "parameter-tampering" ? (
                <Loader2 className="size-4 animate-spin" />
              ) : null}
              Run scenario
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Replay</CardTitle>
            <CardDescription>
              Legitimate $15 purchase with your approval, then concurrent and sequential retries.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <Button
              type="button"
              variant="destructive"
              size="sm"
              disabled={loading !== null}
              onClick={() => void runScenario("replay")}
            >
              {loading === "replay" ? <Loader2 className="size-4 animate-spin" /> : null}
              Run scenario
            </Button>
            <p className="text-xs text-muted-foreground">
              Runs a real Stripe test-mode charge of $15 (counts toward the $50 daily limit; use
              Reset demo on Overview).
            </p>
          </CardContent>
        </Card>
      </div>

      {last?.scenario === "parameter-tampering" && last.claimed && auth ? (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold">Agent claimed vs authoritative (database)</h3>
          <div className="overflow-hidden rounded-lg border border-border">
            <Table>
              <THead>
                <TR>
                  <TH>Field</TH>
                  <TH>Agent claimed</TH>
                  <TH>Authoritative</TH>
                </TR>
              </THead>
              <TBody>
                <TR>
                  <TD>Amount</TD>
                  <TD className="font-mono">{formatCents(last.claimed.amount_cents)}</TD>
                  <TD className="font-mono text-amber-400">
                    {formatCents(auth.amount_cents)}
                  </TD>
                </TR>
                <TR>
                  <TD>Recurring</TD>
                  <TD className="font-mono">{String(last.claimed.recurring)}</TD>
                  <TD className="font-mono text-amber-400">{String(auth.recurring)}</TD>
                </TR>
                <TR>
                  <TD>Merchant</TD>
                  <TD className="font-mono">{last.claimed.merchant}</TD>
                  <TD className="font-mono text-amber-400">{auth.merchant}</TD>
                </TR>
                <TR>
                  <TD>Product</TD>
                  <TD className="text-muted-foreground">—</TD>
                  <TD>{auth.product_name}</TD>
                </TR>
              </TBody>
            </Table>
          </div>
        </div>
      ) : null}

      {replaySummary ? (
        <div className="rounded-lg border border-violet-500/30 bg-violet-500/5 p-4 font-mono text-sm">
          <p className="text-emerald-400">{replaySummary.original}</p>
          {replaySummary.retries.map((line, i) => (
            <p key={i} className="text-violet-400">{line}</p>
          ))}
          <p className="mt-2 text-foreground">
            ADDITIONAL CHARGE: {formatCents(replaySummary.additionalCents)}
          </p>
          <p className="text-muted-foreground">
            executions_for_intent = {replaySummary.executionsForIntent ?? "—"}
          </p>
        </div>
      ) : null}

      {last && last.steps.length > 0 ? (
        <section className="space-y-3">
          <h3 className="text-sm font-semibold capitalize">{last.scenario.replace(/-/g, " ")} results</h3>
          <ul className="space-y-2">
            {last.steps.map((step, i) => (
              <StepRow key={`${step.label}-${i}`} step={step} />
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

function summarizeReplay(response: AttackResponse): {
  original: string;
  retries: string[];
  additionalCents: number;
  executionsForIntent: number | null;
} {
  const retries: string[] = [];
  let original = "ORIGINAL: pending";
  for (const step of response.steps) {
    const pill = stepPill(step.result);
    if (step.label.includes("approve") || step.label.includes("executes once")) {
      original = `ORIGINAL: ${pill.label}`;
    }
    if (step.label.toLowerCase().includes("retry")) {
      retries.push(`RETRY: ${pill.label}`);
    }
  }
  const first = stepPill(response.steps[1]?.result);
  if (original === "ORIGINAL: pending" && response.steps.length > 1) {
    original = `ORIGINAL: ${first.label}`;
  }
  return {
    original,
    retries,
    additionalCents: response.additional_charge_cents ?? 0,
    executionsForIntent: response.executions_for_intent ?? null,
  };
}

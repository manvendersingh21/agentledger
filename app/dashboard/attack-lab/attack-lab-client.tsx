"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { ArrowUpRight, ChevronDown, ChevronRight, Loader2 } from "lucide-react";
interface AuthoritativeTerms {
  product_name: string;
  merchant: string;
  amount_cents: number;
  recurring: boolean;
}
import { CodeBlock } from "@/components/ui/code-block";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { Eyebrow } from "@/components/brand/eyebrow";
import { cn, formatCents } from "@/lib/utils";

type ScenarioId = "prompt-injection" | "parameter-tampering" | "replay";

type PillVariant = "red" | "emerald" | "violet" | "amber" | "sky" | "neutral";

const PILL_CLASS: Record<PillVariant, string> = {
  red: "bg-blocked-bg text-blocked",
  emerald: "bg-executed-bg text-executed",
  violet: "bg-duplicate-bg text-duplicate",
  amber: "bg-waiting-bg text-waiting",
  sky: "bg-approved-bg text-approved",
  neutral: "bg-[#F2F2F2] text-ink-2",
};

function OutcomePill({ variant, children, className }: { variant: PillVariant; children: ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-[4px] px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.08em]",
        PILL_CLASS[variant],
        className,
      )}
    >
      {children}
    </span>
  );
}

interface ScenarioDef {
  id: ScenarioId;
  number: string;
  title: string;
  description: string;
  expect: string;
  note?: string;
}

const SCENARIOS: ScenarioDef[] = [
  {
    id: "prompt-injection",
    number: "01",
    title: "Prompt injection",
    description: "Malicious merchant listing tries to override purchase policy.",
    expect: "Expect BLOCKED",
  },
  {
    id: "parameter-tampering",
    number: "02",
    title: "Parameter tampering",
    description:
      "Agent claims $5 one-time from acme-api for Evil Cloud; server uses authoritative $500 recurring terms.",
    expect: "Expect authoritative terms",
  },
  {
    id: "replay",
    number: "03",
    title: "Replay",
    description:
      "Legitimate $15 purchase with your approval, then concurrent and sequential retries.",
    expect: "Expect DUPLICATE BLOCKED",
    note: "Runs a real Stripe test-mode charge of $15 (counts toward the $50 daily limit; use Reset demo on Overview).",
  },
];

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

function stepPill(result: unknown): { label: string; variant: PillVariant } {
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

function StepRow({ step, index }: { step: AttackStep; index: number }) {
  const [open, setOpen] = useState(false);
  const pill = stepPill(step.result);
  const intentId = intentIdFromResult(step.result);

  return (
    <li className="border-t border-line first:border-t-0">
      <div className="flex items-start gap-4 px-5 py-4 sm:px-6">
        <span className="w-6 shrink-0 pt-1 font-mono text-xs text-ink-3">
          {String(index + 1).padStart(2, "0")}
        </span>
        <button
          type="button"
          aria-expanded={open}
          className="flex min-w-0 flex-1 items-start gap-3 text-left"
          onClick={() => setOpen((o) => !o)}
        >
          <div className="min-w-0 flex-1 space-y-2">
            <div className="flex flex-wrap items-center gap-3">
              <OutcomePill variant={pill.variant}>{pill.label}</OutcomePill>
              <span className="text-[15px] text-ink">{step.label}</span>
            </div>
          </div>
          {open ? (
            <ChevronDown className="mt-1 size-4 shrink-0 text-ink-3" />
          ) : (
            <ChevronRight className="mt-1 size-4 shrink-0 text-ink-3" />
          )}
        </button>
      </div>
      {intentId ? (
        <div className="-mt-2 pb-4 pl-15 pr-5 sm:pl-16">
          <Link
            href={`/dashboard/transactions/${intentId}`}
            className="inline-flex items-center gap-1 font-mono text-xs text-accent hover:text-accent-hover hover:underline"
          >
            View transaction timeline
            <ArrowUpRight className="size-3" />
          </Link>
        </div>
      ) : null}
      {open ? (
        <div className="border-t border-line bg-canvas p-4 sm:p-6">
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
    <div className="space-y-8">
      {error ? (
        <p className="rounded-[6px] bg-blocked-bg px-5 py-4 text-sm font-medium text-blocked">
          {error}
        </p>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-3">
        {SCENARIOS.map((scenario) => {
          const isActive = last?.scenario === scenario.id;
          const isLoading = loading === scenario.id;
          return (
            <article
              key={scenario.id}
              className={cn(
                "flex flex-col gap-8 rounded-[6px] p-6 transition-colors sm:p-8",
                isActive ? "bg-inverse text-white" : "border border-line bg-surface text-ink",
              )}
            >
              <div className="flex items-start justify-between gap-4">
                <span
                  className={cn(
                    "font-display text-7xl font-semibold leading-[0.85] tracking-[-0.045em] sm:text-8xl",
                    isActive ? "text-white" : "text-accent",
                  )}
                >
                  {scenario.number}
                </span>
                {isActive ? (
                  <OutcomePill variant="neutral" className="bg-white/10 text-white">
                    Last run
                  </OutcomePill>
                ) : null}
              </div>
              <div className="space-y-3">
                <h2 className="font-display text-3xl font-semibold leading-[0.95] tracking-[-0.045em]">
                  {scenario.title}
                </h2>
                <p className={cn("text-[15px] leading-relaxed", isActive ? "text-white/70" : "text-ink-2")}>
                  {scenario.description}
                </p>
                <p
                  className={cn(
                    "text-[11px] font-semibold uppercase tracking-[0.08em]",
                    isActive ? "text-white/50" : "text-ink-3",
                  )}
                >
                  {scenario.expect}
                </p>
              </div>
              <div className="mt-auto space-y-3">
                <button
                  type="button"
                  disabled={loading !== null}
                  onClick={() => void runScenario(scenario.id)}
                  className={cn(
                    "group inline-flex h-12 items-stretch overflow-hidden rounded-[4px] text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50",
                    isActive ? "bg-white text-ink" : "bg-inverse text-white",
                  )}
                >
                  <span className="inline-flex items-center gap-2 px-5">
                    {isLoading ? <Loader2 className="size-4 animate-spin" /> : null}
                    {isLoading ? "Running…" : "Run scenario"}
                  </span>
                  <span
                    className={cn(
                      "inline-flex w-12 items-center justify-center border-l",
                      isActive ? "border-line" : "border-white/15",
                    )}
                  >
                    <ArrowUpRight className="size-4 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
                  </span>
                </button>
                {scenario.note ? (
                  <p className={cn("text-xs", isActive ? "text-white/50" : "text-ink-3")}>
                    {scenario.note}
                  </p>
                ) : null}
              </div>
            </article>
          );
        })}
      </div>

      {last?.scenario === "parameter-tampering" && last.claimed && auth ? (
        <section className="space-y-4 rounded-[6px] border border-line bg-surface p-6 sm:p-8">
          <Eyebrow>Authoritative terms</Eyebrow>
          <h3 className="font-display text-3xl font-semibold leading-[0.95] tracking-[-0.045em] text-ink">
            Agent claimed vs <span className="text-accent">authoritative</span> (database)
          </h3>
          <div className="overflow-hidden rounded-[6px] border border-line">
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
                  <TD className="font-mono text-ink-3 line-through">
                    {formatCents(last.claimed.amount_cents)}
                  </TD>
                  <TD className="font-mono font-semibold text-accent">
                    {formatCents(auth.amount_cents)}
                  </TD>
                </TR>
                <TR>
                  <TD>Recurring</TD>
                  <TD className="font-mono text-ink-3 line-through">
                    {String(last.claimed.recurring)}
                  </TD>
                  <TD className="font-mono font-semibold text-accent">{String(auth.recurring)}</TD>
                </TR>
                <TR>
                  <TD>Merchant</TD>
                  <TD className="font-mono text-ink-3 line-through">{last.claimed.merchant}</TD>
                  <TD className="font-mono font-semibold text-accent">{auth.merchant}</TD>
                </TR>
                <TR>
                  <TD>Product</TD>
                  <TD className="text-ink-3">—</TD>
                  <TD className="text-ink">{auth.product_name}</TD>
                </TR>
              </TBody>
            </Table>
          </div>
        </section>
      ) : null}

      {replaySummary ? (
        <section className="grid gap-6 rounded-[6px] bg-inverse p-6 text-white sm:p-8 md:grid-cols-[minmax(0,1fr)_auto]">
          <div className="space-y-3">
            <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-white/50">
              Replay outcome
            </p>
            <div className="flex flex-wrap gap-2">
              <OutcomePill variant="emerald">{replaySummary.original}</OutcomePill>
              {replaySummary.retries.map((line, i) => (
                <OutcomePill key={i} variant="violet">
                  {line}
                </OutcomePill>
              ))}
            </div>
            <p className="font-mono text-xs text-white/50">
              executions_for_intent = {replaySummary.executionsForIntent ?? "—"}
            </p>
          </div>
          <div className="md:text-right">
            <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-white/50">
              Additional charge
            </p>
            <p className="font-display text-6xl font-semibold leading-none tracking-[-0.045em] tabular-nums">
              {formatCents(replaySummary.additionalCents)}
            </p>
          </div>
        </section>
      ) : null}

      {last && last.steps.length > 0 ? (
        <section className="space-y-4">
          <div className="space-y-2">
            <Eyebrow>Pipeline trace</Eyebrow>
            <h3 className="font-display text-3xl font-semibold capitalize leading-[0.95] tracking-[-0.045em] text-ink">
              {last.scenario.replace(/-/g, " ")} results
            </h3>
          </div>
          <ul className="overflow-hidden rounded-[6px] border border-line bg-surface">
            {last.steps.map((step, i) => (
              <StepRow key={`${step.label}-${i}`} step={step} index={i} />
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

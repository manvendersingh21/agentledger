"use client";

import { useState, type FormEvent } from "react";
import { BadgeCheck, CircleAlert, LoaderCircle, Search, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface MerchantLookup {
  domain: string;
  agentledger_verified: boolean;
  verified_at: string | null;
  scamadviser: {
    score: number | null;
    source: "scamadvisor" | "unavailable";
    checkedAt: string;
  };
  would_pass_default_policy: boolean;
  how_agents_buy: "verified catalog" | "unverified fallback (human approval required)";
}

type RequestState = "idle" | "loading" | "success" | "error";

function errorMessage(payload: unknown, fallback: string): string {
  if (
    typeof payload === "object" &&
    payload !== null &&
    "message" in payload &&
    typeof payload.message === "string"
  ) {
    return payload.message;
  }
  return fallback;
}

function isMerchantLookup(payload: unknown): payload is MerchantLookup {
  if (typeof payload !== "object" || payload === null) return false;
  if (
    !("domain" in payload) ||
    typeof payload.domain !== "string" ||
    !("agentledger_verified" in payload) ||
    typeof payload.agentledger_verified !== "boolean" ||
    !("verified_at" in payload) ||
    (payload.verified_at !== null && typeof payload.verified_at !== "string") ||
    !("would_pass_default_policy" in payload) ||
    typeof payload.would_pass_default_policy !== "boolean" ||
    !("how_agents_buy" in payload) ||
    (payload.how_agents_buy !== "verified catalog" &&
      payload.how_agents_buy !== "unverified fallback (human approval required)") ||
    !("scamadviser" in payload) ||
    typeof payload.scamadviser !== "object" ||
    payload.scamadviser === null
  ) {
    return false;
  }

  const trust = payload.scamadviser;
  return (
    "score" in trust &&
    (trust.score === null || typeof trust.score === "number") &&
    "source" in trust &&
    (trust.source === "scamadvisor" || trust.source === "unavailable") &&
    "checkedAt" in trust &&
    typeof trust.checkedAt === "string"
  );
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

export function DomainLookup() {
  const [domain, setDomain] = useState("");
  const [state, setState] = useState<RequestState>("idle");
  const [result, setResult] = useState<MerchantLookup | null>(null);
  const [message, setMessage] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setState("loading");
    setResult(null);
    setMessage("");

    try {
      const response = await fetch(
        `/api/merchants/lookup?domain=${encodeURIComponent(domain)}`,
        { method: "GET", headers: { Accept: "application/json" } },
      );
      const payload: unknown = await response.json();
      if (!response.ok) {
        setState("error");
        setMessage(errorMessage(payload, "We could not check that domain."));
        return;
      }
      if (!isMerchantLookup(payload)) {
        setState("error");
        setMessage("The lookup returned an unexpected response. Please try again.");
        return;
      }
      setResult(payload);
      setState("success");
    } catch {
      setState("error");
      setMessage("The lookup is temporarily unavailable. Please try again.");
    }
  }

  return (
    <div className="rounded-md border border-line bg-surface p-6 sm:p-8">
      <div className="mb-7 flex items-start justify-between gap-5">
        <div>
          <p className="font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-accent">
            Public lookup
          </p>
          <h2 className="mt-3 font-display text-3xl font-semibold leading-none tracking-[-0.04em] text-ink">
            Check a store.
          </h2>
        </div>
        <span className="flex size-11 shrink-0 items-center justify-center rounded bg-accent-wash text-accent">
          <Search className="size-5" aria-hidden />
        </span>
      </div>

      <form onSubmit={submit} className="space-y-3">
        <Label htmlFor="lookup-domain">Company domain</Label>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input
            id="lookup-domain"
            name="domain"
            value={domain}
            onChange={(event) => setDomain(event.target.value)}
            placeholder="store.example"
            autoCapitalize="none"
            autoCorrect="off"
            inputMode="url"
            required
            maxLength={253}
            className="h-12"
          />
          <Button type="submit" size="lg" disabled={state === "loading"} className="shrink-0">
            {state === "loading" ? (
              <LoaderCircle className="animate-spin" aria-hidden />
            ) : (
              <Search aria-hidden />
            )}
            {state === "loading" ? "Checking" : "Check domain"}
          </Button>
        </div>
        <p className="text-xs leading-relaxed text-ink-3">
          Live trust checks are cached. Verification means domain control, not an endorsement.
        </p>
      </form>

      <div className="mt-6" aria-live="polite">
        {state === "error" ? (
          <div className="flex gap-3 rounded bg-blocked-bg p-4 text-sm text-blocked">
            <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
            <p>{message}</p>
          </div>
        ) : null}

        {state === "success" && result ? (
          <div className="overflow-hidden rounded border border-line">
            <div className="flex flex-col gap-4 border-b border-line bg-canvas p-5 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="truncate font-mono text-sm text-ink">{result.domain}</p>
                <p className="mt-1 text-xs text-ink-3">
                  Checked {formatDate(result.scamadviser.checkedAt)}
                </p>
              </div>
              <span
                className={
                  result.agentledger_verified
                    ? "inline-flex w-fit items-center gap-1.5 rounded bg-approved-bg px-2.5 py-1 font-mono text-[11px] uppercase tracking-[0.1em] text-approved"
                    : "inline-flex w-fit items-center gap-1.5 rounded bg-neutral-bg px-2.5 py-1 font-mono text-[11px] uppercase tracking-[0.1em] text-neutral"
                }
              >
                {result.agentledger_verified ? (
                  <BadgeCheck className="size-3.5" aria-hidden />
                ) : (
                  <CircleAlert className="size-3.5" aria-hidden />
                )}
                {result.agentledger_verified ? "AgentLedger verified" : "Not verified"}
              </span>
            </div>

            <dl className="grid sm:grid-cols-3">
              <div className="border-b border-line p-5 sm:border-b-0 sm:border-r">
                <dt className="text-xs text-ink-3">ScamAdviser trust</dt>
                <dd className="mt-2 font-display text-3xl font-semibold tracking-[-0.04em] text-ink">
                  {result.scamadviser.score === null ? "—" : `${result.scamadviser.score}/100`}
                </dd>
                <p className="mt-1 text-xs text-ink-3">
                  {result.scamadviser.source === "scamadvisor" ? "Live score" : "Unavailable"}
                </p>
              </div>
              <div className="border-b border-line p-5 sm:border-b-0 sm:border-r">
                <dt className="text-xs text-ink-3">Default policy</dt>
                <dd
                  className={`mt-2 text-sm font-medium ${
                    result.would_pass_default_policy ? "text-executed" : "text-waiting"
                  }`}
                >
                  {result.would_pass_default_policy ? "Would pass trust gate" : "Would not pass trust gate"}
                </dd>
                <p className="mt-2 text-xs leading-relaxed text-ink-3">
                  Requires score ≥95 or verified status.
                </p>
              </div>
              <div className="p-5">
                <dt className="text-xs text-ink-3">How agents buy</dt>
                <dd className="mt-2 text-sm font-medium text-ink">
                  {result.agentledger_verified ? "Verified catalog" : "Unverified fallback"}
                </dd>
                <p className="mt-2 text-xs leading-relaxed text-ink-3">
                  {result.agentledger_verified
                    ? result.verified_at
                      ? `Verified ${formatDate(result.verified_at)}`
                      : "Domain control verified"
                    : "Human approval is always required."}
                </p>
              </div>
            </dl>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function MerchantApplication() {
  const [state, setState] = useState<RequestState>("idle");
  const [message, setMessage] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setState("loading");
    setMessage("");

    const form = event.currentTarget;
    const data = new FormData(form);
    const body = {
      company_name: String(data.get("company_name") ?? ""),
      domain: String(data.get("domain") ?? ""),
      contact_name: String(data.get("contact_name") ?? ""),
      contact_email: String(data.get("contact_email") ?? ""),
      message: String(data.get("message") ?? ""),
      website: String(data.get("website") ?? ""),
    };

    try {
      const response = await fetch("/api/merchants/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(body),
      });
      const payload: unknown = await response.json();
      if (!response.ok) {
        setState("error");
        setMessage(errorMessage(payload, "We could not send your application."));
        return;
      }
      setState("success");
      setMessage("Thanks — your merchant application is in. We’ll follow up by email.");
      form.reset();
    } catch {
      setState("error");
      setMessage("The application service is temporarily unavailable. Please try again.");
    }
  }

  return (
    <form onSubmit={submit} className="rounded-md border border-line bg-surface p-6 sm:p-8">
      <div className="mb-7">
        <p className="font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-accent">
          Talk to us
        </p>
        <h2 className="mt-3 font-display text-3xl font-semibold leading-none tracking-[-0.04em] text-ink">
          Bring your catalog.
        </h2>
        <p className="mt-3 max-w-lg text-sm leading-relaxed text-ink-2">
          Tell us about your store and the agent checkout experience you want to offer.
        </p>
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="company-name">Company name</Label>
          <Input id="company-name" name="company_name" required maxLength={200} autoComplete="organization" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="application-domain">Domain</Label>
          <Input
            id="application-domain"
            name="domain"
            required
            maxLength={253}
            placeholder="store.example"
            autoCapitalize="none"
            autoCorrect="off"
            inputMode="url"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="contact-name">Your name</Label>
          <Input id="contact-name" name="contact_name" required maxLength={200} autoComplete="name" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="contact-email">Work email</Label>
          <Input
            id="contact-email"
            name="contact_email"
            type="email"
            required
            maxLength={320}
            autoComplete="email"
          />
        </div>
      </div>

      <div className="mt-5 space-y-2">
        <Label htmlFor="application-message">What should agents be able to buy?</Label>
        <textarea
          id="application-message"
          name="message"
          rows={5}
          maxLength={2000}
          placeholder="Share your catalog, checkout flow, or launch timeline."
          className="w-full resize-y rounded-sm border border-line bg-surface px-3 py-2 text-sm text-ink transition-colors placeholder:text-ink-3 hover:border-[#CFCFCF] focus-visible:border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-wash"
        />
      </div>

      <div className="absolute -left-[10000px] top-auto size-px overflow-hidden" aria-hidden="true">
        <Label htmlFor="merchant-website">Website</Label>
        <Input
          id="merchant-website"
          name="website"
          tabIndex={-1}
          autoComplete="off"
        />
      </div>

      <div className="mt-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs leading-relaxed text-ink-3">
          We use these details only to respond to this inquiry.
        </p>
        <Button type="submit" size="lg" disabled={state === "loading"} className="shrink-0">
          {state === "loading" ? <LoaderCircle className="animate-spin" aria-hidden /> : null}
          {state === "loading" ? "Sending" : "Request access"}
        </Button>
      </div>

      <div aria-live="polite">
        {state === "success" ? (
          <div className="mt-5 flex gap-3 rounded bg-executed-bg p-4 text-sm text-executed">
            <ShieldCheck className="mt-0.5 size-4 shrink-0" aria-hidden />
            <p>{message}</p>
          </div>
        ) : null}
        {state === "error" ? (
          <div className="mt-5 flex gap-3 rounded bg-blocked-bg p-4 text-sm text-blocked">
            <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
            <p>{message}</p>
          </div>
        ) : null}
      </div>
    </form>
  );
}

"use client";

import { useState } from "react";
import { Globe, Loader2 } from "lucide-react";
import type { MerchantRegistration, RegistrationStatus, VerificationMethod } from "@/lib/registry/verify";
import { CodeBlock } from "@/components/ui/code-block";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ArrowButton } from "@/components/brand/arrow-button";
import { Eyebrow } from "@/components/brand/eyebrow";
import { cn, formatDateTime } from "@/lib/utils";

const FIXTURE_SLUGS = new Set(["acme-api", "vectorbase"]);

function statusClass(status: RegistrationStatus): string {
  if (status === "verified") return "bg-executed-bg text-executed";
  if (status === "pending") return "bg-waiting-bg text-waiting";
  if (status === "failed") return "bg-blocked-bg text-blocked";
  if (status === "revoked") return "bg-duplicate-bg text-duplicate";
  return "bg-[#F2F2F2] text-ink-2";
}

const PILL = "inline-flex items-center rounded-[4px] px-2 py-1 text-[11px] font-semibold uppercase tracking-[0.08em]";
const FIELD_LABEL = "text-xs font-medium uppercase tracking-[0.08em] text-ink-2";

function dnsInstructions(domain: string, token: string) {
  return {
    type: "TXT",
    name: `_agentledger.${domain}`,
    value: `agentledger-verification=${token}`,
  };
}

function wellKnownInstructions(token: string) {
  return {
    agentledger_verification: token,
  };
}

interface RegistryClientProps {
  initialRegistrations: MerchantRegistration[];
}

export function RegistryClient({ initialRegistrations }: RegistryClientProps) {
  const [registrations, setRegistrations] = useState(initialRegistrations);
  const [companyName, setCompanyName] = useState("");
  const [domain, setDomain] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [method, setMethod] = useState<VerificationMethod>("dns_txt");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [checkingId, setCheckingId] = useState<string | null>(null);

  async function refreshList() {
    const res = await fetch("/api/registry");
    if (!res.ok) return;
    const json = (await res.json()) as { registrations: MerchantRegistration[] };
    setRegistrations(json.registrations);
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setFormError(null);
    try {
      const res = await fetch("/api/registry", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          company_name: companyName,
          domain,
          contact_email: contactEmail,
          verification_method: method,
        }),
      });
      const json = (await res.json()) as { registration?: MerchantRegistration; message?: string; error?: string };
      if (!res.ok) {
        setFormError(json.message ?? "Could not create registration.");
        return;
      }
      if (json.registration) {
        setRegistrations((prev) => [json.registration!, ...prev]);
      } else {
        await refreshList();
      }
      setCompanyName("");
      setDomain("");
      setContactEmail("");
    } catch {
      setFormError("Could not create registration.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleVerify(id: string) {
    setCheckingId(id);
    try {
      const res = await fetch(`/api/registry/${id}/verify`, { method: "POST" });
      const json = (await res.json()) as { registration?: MerchantRegistration };
      if (json.registration) {
        setRegistrations((prev) => prev.map((r) => (r.id === id ? json.registration! : r)));
      } else {
        await refreshList();
      }
    } finally {
      setCheckingId(null);
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] lg:items-start">
      <section className="rounded-[6px] border border-line bg-surface p-6 sm:p-8 lg:sticky lg:top-6">
        <div className="mb-8 space-y-3">
          <Eyebrow>New registration</Eyebrow>
          <h2 className="font-display text-3xl font-semibold leading-[0.95] tracking-[-0.045em] text-ink sm:text-4xl">
            Register a <span className="text-accent">domain</span>
          </h2>
          <p className="text-[15px] leading-relaxed text-ink-2">
            After submitting, publish the DNS TXT record or HTTPS well-known file below, then run
            verification.
          </p>
        </div>
        <form onSubmit={handleSubmit} className="grid gap-5">
          <div className="space-y-2">
            <Label htmlFor="company_name" className={FIELD_LABEL}>
              Company name
            </Label>
            <Input
              id="company_name"
              className="h-11 bg-surface"
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
              required
              maxLength={200}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="domain" className={FIELD_LABEL}>
              Domain
            </Label>
            <Input
              id="domain"
              className="h-11 bg-surface font-mono"
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
              placeholder="example.com"
              required
              maxLength={253}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="contact_email" className={FIELD_LABEL}>
              Contact email
            </Label>
            <Input
              id="contact_email"
              type="email"
              className="h-11 bg-surface"
              value={contactEmail}
              onChange={(e) => setContactEmail(e.target.value)}
              required
              maxLength={320}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="verification_method" className={FIELD_LABEL}>
              Verification method
            </Label>
            <select
              id="verification_method"
              className="flex h-11 w-full rounded-[4px] border border-line bg-surface px-3 text-sm text-ink focus-visible:border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft"
              value={method}
              onChange={(e) => setMethod(e.target.value as VerificationMethod)}
            >
              <option value="dns_txt">DNS TXT (_agentledger)</option>
              <option value="well_known">HTTPS well-known JSON</option>
            </select>
          </div>
          {formError ? (
            <p className="rounded-[4px] bg-blocked-bg px-3 py-2 text-sm text-blocked">{formError}</p>
          ) : null}
          <div className="pt-2">
            <ArrowButton type="submit" disabled={submitting}>
              {submitting ? <Loader2 className="size-4 animate-spin" /> : null}
              Register domain
            </ArrowButton>
          </div>
        </form>
      </section>

      <section className="space-y-4">
        <div className="flex items-end justify-between gap-4">
          <div className="space-y-2">
            <Eyebrow>Your registrations</Eyebrow>
            <h2 className="font-display text-3xl font-semibold leading-[0.95] tracking-[-0.045em] text-ink">
              Domains
            </h2>
          </div>
          <span className="font-mono text-sm tabular-nums text-ink-3">
            {String(registrations.length).padStart(2, "0")}
          </span>
        </div>
        {registrations.length === 0 ? (
          <p className="rounded-[6px] border border-line bg-surface px-6 py-12 text-center text-sm text-ink-2">
            No domains registered yet.
          </p>
        ) : (
          <ul className="overflow-hidden rounded-[6px] border border-line bg-surface">
            {registrations.map((reg) => {
              const slugGuess = reg.domain.replace(/\./g, "-");
              const isFixtureHint = FIXTURE_SLUGS.has(slugGuess) || FIXTURE_SLUGS.has(reg.domain.split(".")[0] ?? "");
              return (
                <li key={reg.id} className="space-y-5 border-t border-line p-6 first:border-t-0 sm:p-8">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="flex min-w-0 items-start gap-4">
                      <span className="inline-flex size-11 shrink-0 items-center justify-center rounded-[6px] bg-canvas text-ink-2">
                        <Globe className="size-5" />
                      </span>
                      <div className="min-w-0 space-y-1">
                        <h3 className="font-display text-2xl font-semibold leading-none tracking-[-0.045em] text-ink">
                          {reg.company_name}
                        </h3>
                        <p className="break-all font-mono text-sm text-accent">{reg.domain}</p>
                        <p className="text-xs text-ink-3">
                          {reg.contact_email} · created {formatDateTime(reg.created_at)}
                        </p>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <span className={cn(PILL, statusClass(reg.status))}>{reg.status}</span>
                      {isFixtureHint && reg.status === "verified" ? (
                        <span className={cn(PILL, "bg-approved-bg text-approved")}>demo fixture</span>
                      ) : null}
                    </div>
                  </div>

                  {reg.status === "pending" || reg.status === "failed" ? (
                    <div className="space-y-3 rounded-[6px] bg-canvas p-4 sm:p-5">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-2">
                        Publish this proof
                      </p>
                      {reg.verification_method === "dns_txt" ? (
                        <CodeBlock
                          title="DNS TXT record"
                          value={dnsInstructions(reg.domain, reg.verification_token)}
                        />
                      ) : (
                        <>
                          <p className="text-xs text-ink-2">
                            Host at{" "}
                            <span className="font-mono text-ink">
                              https://{reg.domain}/.well-known/agentledger.json
                            </span>
                          </p>
                          <CodeBlock title="agentledger.json" value={wellKnownInstructions(reg.verification_token)} />
                        </>
                      )}
                      <ArrowButton
                        type="button"
                        variant="secondary"
                        disabled={checkingId === reg.id}
                        onClick={() => handleVerify(reg.id)}
                      >
                        {checkingId === reg.id ? (
                          <Loader2 className="size-4 animate-spin" />
                        ) : null}
                        Check verification
                      </ArrowButton>
                    </div>
                  ) : null}
                  {reg.last_error ? (
                    <p className="rounded-[4px] bg-blocked-bg px-3 py-2 text-sm text-blocked">
                      Last check: {reg.last_error}
                    </p>
                  ) : null}
                  {reg.verified_at ? (
                    <p className="text-sm text-ink-2">
                      Verified <span className="font-mono">{formatDateTime(reg.verified_at)}</span>
                    </p>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

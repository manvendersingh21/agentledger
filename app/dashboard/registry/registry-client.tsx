"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import type { MerchantRegistration, RegistrationStatus, VerificationMethod } from "@/lib/registry/verify";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CodeBlock } from "@/components/ui/code-block";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatDateTime } from "@/lib/utils";

const FIXTURE_SLUGS = new Set(["acme-api", "vectorbase"]);

function statusVariant(status: RegistrationStatus): "emerald" | "amber" | "red" | "neutral" | "violet" {
  if (status === "verified") return "emerald";
  if (status === "pending") return "amber";
  if (status === "failed") return "red";
  if (status === "revoked") return "violet";
  return "neutral";
}

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
    <div className="space-y-8">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Register a domain</CardTitle>
          <CardDescription>
            After submitting, publish the DNS TXT record or HTTPS well-known file below, then run
            verification.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="grid max-w-xl gap-4">
            <div className="space-y-2">
              <Label htmlFor="company_name">Company name</Label>
              <Input
                id="company_name"
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                required
                maxLength={200}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="domain">Domain</Label>
              <Input
                id="domain"
                value={domain}
                onChange={(e) => setDomain(e.target.value)}
                placeholder="example.com"
                required
                maxLength={253}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="contact_email">Contact email</Label>
              <Input
                id="contact_email"
                type="email"
                value={contactEmail}
                onChange={(e) => setContactEmail(e.target.value)}
                required
                maxLength={320}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="verification_method">Verification method</Label>
              <select
                id="verification_method"
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={method}
                onChange={(e) => setMethod(e.target.value as VerificationMethod)}
              >
                <option value="dns_txt">DNS TXT (_agentledger)</option>
                <option value="well_known">HTTPS well-known JSON</option>
              </select>
            </div>
            {formError ? <p className="text-sm text-red-400">{formError}</p> : null}
            <Button type="submit" disabled={submitting}>
              {submitting ? <Loader2 className="size-4 animate-spin" /> : null}
              Register domain
            </Button>
          </form>
        </CardContent>
      </Card>

      <section className="space-y-4">
        <h2 className="text-sm font-semibold">Your registrations</h2>
        {registrations.length === 0 ? (
          <p className="text-sm text-muted-foreground">No domains registered yet.</p>
        ) : (
          <ul className="space-y-4">
            {registrations.map((reg) => {
              const slugGuess = reg.domain.replace(/\./g, "-");
              const isFixtureHint = FIXTURE_SLUGS.has(slugGuess) || FIXTURE_SLUGS.has(reg.domain.split(".")[0] ?? "");
              return (
                <li key={reg.id}>
                  <Card>
                    <CardHeader>
                      <div className="flex flex-wrap items-center gap-2">
                        <CardTitle className="text-base">{reg.company_name}</CardTitle>
                        <Badge variant={statusVariant(reg.status)} className="normal-case tracking-normal">
                          {reg.status}
                        </Badge>
                        {isFixtureHint && reg.status === "verified" ? (
                          <Badge variant="sky" className="normal-case tracking-normal">
                            demo fixture
                          </Badge>
                        ) : null}
                      </div>
                      <CardDescription>
                        {reg.domain} · {reg.contact_email} · created {formatDateTime(reg.created_at)}
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      {reg.status === "pending" || reg.status === "failed" ? (
                        <div className="space-y-2">
                          <p className="text-sm font-medium">Publish this proof</p>
                          {reg.verification_method === "dns_txt" ? (
                            <CodeBlock
                              title="DNS TXT record"
                              value={dnsInstructions(reg.domain, reg.verification_token)}
                            />
                          ) : (
                            <>
                              <p className="text-xs text-muted-foreground">
                                Host at{" "}
                                <span className="font-mono">
                                  https://{reg.domain}/.well-known/agentledger.json
                                </span>
                              </p>
                              <CodeBlock title="agentledger.json" value={wellKnownInstructions(reg.verification_token)} />
                            </>
                          )}
                          <Button
                            type="button"
                            variant="secondary"
                            disabled={checkingId === reg.id}
                            onClick={() => handleVerify(reg.id)}
                          >
                            {checkingId === reg.id ? (
                              <Loader2 className="size-4 animate-spin" />
                            ) : null}
                            Check verification
                          </Button>
                        </div>
                      ) : null}
                      {reg.last_error ? (
                        <p className="text-sm text-red-400">Last check: {reg.last_error}</p>
                      ) : null}
                      {reg.verified_at ? (
                        <p className="text-sm text-muted-foreground">
                          Verified {formatDateTime(reg.verified_at)}
                        </p>
                      ) : null}
                    </CardContent>
                  </Card>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

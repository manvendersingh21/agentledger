"use client";

import { useCallback, useEffect, useState } from "react";
import { Globe, KeyRound, Loader2, Package, RefreshCw } from "lucide-react";
import type { MerchantRegistration, RegistrationStatus, VerificationMethod } from "@/lib/registry/verify";
import { CodeBlock } from "@/components/ui/code-block";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ArrowButton } from "@/components/brand/arrow-button";
import { Eyebrow } from "@/components/brand/eyebrow";
import { cn, formatCents, formatDateTime } from "@/lib/utils";

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

interface MerchantKeySummary {
  id: string;
  key_prefix: string;
  created_at: string;
  revoked_at: string | null;
}

interface PublishedProduct {
  id: string;
  sku: string;
  name: string;
  price_cents: number;
  currency: string;
  recurring: boolean;
  category: string;
  active: boolean;
  created_at: string;
}

interface CatalogResponse {
  keys: MerchantKeySummary[];
  products: PublishedProduct[];
  message?: string;
}

async function requestCatalog(registrationId: string): Promise<CatalogResponse> {
  const response = await fetch(`/api/registry/${registrationId}/keys`);
  const json = (await response.json()) as CatalogResponse;
  if (!response.ok) {
    throw new Error(json.message ?? "Could not load the published catalog.");
  }
  return json;
}

const FEED_EXAMPLE = `curl https://agentledger-cyan.vercel.app/api/merchant/v1/products \\
  -X POST \\
  -H "Authorization: Bearer $AGENTLEDGER_MERCHANT_KEY" \\
  -H "Content-Type: application/json" \\
  --data '{
    "products": [{
      "sku": "starter-plan",
      "name": "Starter plan",
      "description": "One month of service.",
      "price_cents": 1900,
      "currency": "usd",
      "recurring": false,
      "category": "software",
      "attributes": {},
      "market_price_cents": 2000
    }]
  }'`;

function CatalogPanel({ registrationId }: { registrationId: string }) {
  const [catalog, setCatalog] = useState<CatalogResponse>({ keys: [], products: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [generatedKey, setGeneratedKey] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);

  const loadCatalog = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setCatalog(await requestCatalog(registrationId));
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Could not load the published catalog.",
      );
    } finally {
      setLoading(false);
    }
  }, [registrationId]);

  useEffect(() => {
    let cancelled = false;
    void requestCatalog(registrationId)
      .then((response) => {
        if (!cancelled) setCatalog(response);
      })
      .catch((loadError: unknown) => {
        if (!cancelled) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "Could not load the published catalog.",
          );
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [registrationId]);

  async function generateKey() {
    setGenerating(true);
    setError(null);
    try {
      const response = await fetch(`/api/registry/${registrationId}/keys`, {
        method: "POST",
      });
      const json = (await response.json()) as {
        api_key?: string;
        key?: MerchantKeySummary;
        message?: string;
      };
      if (!response.ok || !json.api_key || !json.key) {
        setError(json.message ?? "Could not generate an API key.");
        return;
      }
      setGeneratedKey(json.api_key);
      setCatalog((current) => ({ ...current, keys: [json.key!, ...current.keys] }));
    } catch {
      setError("Could not generate an API key.");
    } finally {
      setGenerating(false);
    }
  }

  async function revokeKey(keyId: string) {
    setRevokingId(keyId);
    setError(null);
    try {
      const response = await fetch(`/api/registry/${registrationId}/keys`, {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ key_id: keyId }),
      });
      const json = (await response.json()) as {
        key?: MerchantKeySummary;
        message?: string;
      };
      if (!response.ok || !json.key) {
        setError(json.message ?? "Could not revoke the API key.");
        return;
      }
      setCatalog((current) => ({
        ...current,
        keys: current.keys.map((key) => (key.id === keyId ? json.key! : key)),
      }));
    } catch {
      setError("Could not revoke the API key.");
    } finally {
      setRevokingId(null);
    }
  }

  return (
    <div className="space-y-6 rounded-[6px] border border-line bg-canvas p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-accent">
            <Package className="size-3.5" />
            Publish catalog
          </p>
          <p className="max-w-xl text-sm leading-relaxed text-ink-2">
            Send authoritative product terms with a merchant API key. Descriptions are stored as
            untrusted merchant content and remain subject to AgentLedger policy.
          </p>
        </div>
        <ArrowButton
          type="button"
          size="md"
          disabled={generating}
          onClick={generateKey}
          icon={<KeyRound className="size-4" />}
        >
          {generating ? <Loader2 className="size-4 animate-spin" /> : null}
          Generate API key
        </ArrowButton>
      </div>

      {generatedKey ? (
        <div className="space-y-2 rounded-[6px] border border-waiting/30 bg-waiting-bg p-4">
          <p className="text-sm font-medium text-waiting">
            Copy this key now. It will not be shown again.
          </p>
          <CodeBlock title="New merchant API key" value={generatedKey} />
        </div>
      ) : null}

      {error ? (
        <p className="rounded-[4px] bg-blocked-bg px-3 py-2 text-sm text-blocked">{error}</p>
      ) : null}

      <div className="grid gap-5 xl:grid-cols-2">
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <h4 className="text-xs font-semibold uppercase tracking-[0.08em] text-ink-2">
              API keys
            </h4>
            <span className="font-mono text-xs text-ink-3">
              {catalog.keys.filter((key) => !key.revoked_at).length} active
            </span>
          </div>
          {loading ? (
            <p className="flex items-center gap-2 text-sm text-ink-3">
              <Loader2 className="size-4 animate-spin" />
              Loading keys
            </p>
          ) : catalog.keys.length === 0 ? (
            <p className="text-sm text-ink-3">No API keys yet.</p>
          ) : (
            <ul className="divide-y divide-line overflow-hidden rounded-[4px] border border-line bg-surface">
              {catalog.keys.map((key) => (
                <li key={key.id} className="flex items-center justify-between gap-3 px-3 py-3">
                  <div className="min-w-0">
                    <p className="font-mono text-xs text-ink">{key.key_prefix}••••</p>
                    <p className="mt-1 text-[11px] text-ink-3">
                      Created {formatDateTime(key.created_at)}
                    </p>
                  </div>
                  {key.revoked_at ? (
                    <span className={cn(PILL, "bg-blocked-bg text-blocked")}>revoked</span>
                  ) : (
                    <button
                      type="button"
                      className="text-xs font-medium text-ink-2 underline decoration-line underline-offset-4 hover:text-blocked"
                      disabled={revokingId === key.id}
                      onClick={() => revokeKey(key.id)}
                    >
                      {revokingId === key.id ? "Revoking…" : "Revoke"}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        <CodeBlock title="Publish with curl" value={FEED_EXAMPLE} />
      </div>

      <div className="space-y-3 border-t border-line pt-5">
        <div className="flex items-center justify-between gap-3">
          <h4 className="text-xs font-semibold uppercase tracking-[0.08em] text-ink-2">
            Published products
          </h4>
          <button
            type="button"
            className="inline-flex items-center gap-1.5 text-xs font-medium text-accent hover:text-accent-hover"
            disabled={loading}
            onClick={() => void loadCatalog()}
          >
            <RefreshCw className={cn("size-3.5", loading && "animate-spin")} />
            Refresh
          </button>
        </div>
        {!loading && catalog.products.length === 0 ? (
          <p className="rounded-[4px] border border-dashed border-line bg-surface px-4 py-6 text-center text-sm text-ink-3">
            No merchant-feed products published yet.
          </p>
        ) : (
          <ul className="divide-y divide-line overflow-hidden rounded-[4px] border border-line bg-surface">
            {catalog.products.map((product) => (
              <li
                key={product.id}
                className="grid gap-2 px-3 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-ink">{product.name}</p>
                  <p className="mt-1 truncate font-mono text-[11px] text-ink-3">
                    {product.sku} · {product.category}
                  </p>
                </div>
                <div className="flex items-center gap-2 sm:justify-end">
                  <span className="font-mono text-sm tabular-nums text-ink">
                    {formatCents(product.price_cents, product.currency)}
                    {product.recurring ? "/period" : ""}
                  </span>
                  <span
                    className={cn(
                      PILL,
                      product.active
                        ? "bg-executed-bg text-executed"
                        : "bg-[#F2F2F2] text-ink-2",
                    )}
                  >
                    {product.active ? "active" : "inactive"}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
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
                  {reg.status === "verified" ? (
                    <CatalogPanel registrationId={reg.id} />
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

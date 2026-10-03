"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { ArrowButton } from "@/components/brand/arrow-button";
import { Eyebrow } from "@/components/brand/eyebrow";

interface AuthorizationDetails {
  authorization_id: string;
  redirect_uri: string;
  client: { id: string; name: string; uri: string; logo_uri: string };
  user: { id: string; email: string };
  scope: string;
}

type DetailsResponse = AuthorizationDetails | { redirect_url: string };

function isAuthorizationDetails(data: DetailsResponse): data is AuthorizationDetails {
  return "authorization_id" in data;
}

export function ConsentForm({ authorizationId }: { authorizationId: string }) {
  const [details, setDetails] = useState<AuthorizationDetails | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deciding, setDeciding] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const supabase = createClient();
    supabase.auth.oauth.getAuthorizationDetails(authorizationId).then(({ data, error }) => {
      if (cancelled) return;
      if (error) {
        setError(error.message);
        return;
      }
      if (!data) {
        setError("Authorization request not found or already resolved.");
        return;
      }
      if (isAuthorizationDetails(data)) {
        setDetails(data);
      } else {
        // Already consented — go straight back to the client.
        window.location.href = data.redirect_url;
      }
    });
    return () => {
      cancelled = true;
    };
  }, [authorizationId]);

  async function decide(approve: boolean) {
    setDeciding(true);
    setError(null);
    const supabase = createClient();
    const { data, error } = approve
      ? await supabase.auth.oauth.approveAuthorization(authorizationId, { skipBrowserRedirect: true })
      : await supabase.auth.oauth.denyAuthorization(authorizationId, { skipBrowserRedirect: true });
    if (error || !data) {
      setError(error?.message ?? "The authorization request could not be resolved.");
      setDeciding(false);
      return;
    }
    window.location.href = data.redirect_url;
  }

  return (
    <div className="w-full max-w-md rounded-md border border-line bg-surface p-8">
      {error && (
        <div>
          <Eyebrow>Authorization</Eyebrow>
          <h1 className="mt-4 font-display text-3xl font-semibold leading-[0.95] tracking-[-0.045em] text-ink">
            Authorization unavailable
          </h1>
          <p role="alert" className="mt-4 rounded border border-blocked/30 bg-blocked-bg px-3 py-2 text-sm text-blocked">
            {error}
          </p>
          <p className="mt-4 text-xs leading-relaxed text-ink-3">
            The request may have expired or already been resolved. Closing this window is safe: denial is the
            default outcome.
          </p>
        </div>
      )}

      {!error && !details && <p className="text-sm text-ink-3">Loading authorization request…</p>}

      {!error && details && (
        <>
          <Eyebrow>Agent authorization</Eyebrow>
          <div className="mt-5 flex items-center gap-4">
            {details.client.logo_uri ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={details.client.logo_uri}
                alt=""
                className="h-12 w-12 rounded border border-line bg-canvas object-contain"
              />
            ) : (
              <div className="flex h-12 w-12 items-center justify-center rounded bg-accent font-display text-lg font-semibold text-white">
                {details.client.name.slice(0, 1).toUpperCase()}
              </div>
            )}
            <div className="min-w-0">
              <h1 className="font-display text-3xl font-semibold leading-[0.95] tracking-[-0.045em] text-ink">
                Authorize <span className="text-accent">{details.client.name}</span>
              </h1>
              <p className="mt-1.5 truncate text-xs text-ink-3">Signed in as {details.user.email}</p>
            </div>
          </div>

          <div className="mt-8 space-y-4 text-sm">
            <div>
              <h2 className="mb-3 text-[11px] font-medium uppercase tracking-[0.12em] text-ink-2">
                This agent requests access to
              </h2>
              <ul className="space-y-1.5">
                {details.scope
                  .split(" ")
                  .filter(Boolean)
                  .map((scope) => (
                    <li
                      key={scope}
                      className="rounded border border-line bg-canvas px-3 py-2 font-mono text-xs text-ink"
                    >
                      {scope}
                    </li>
                  ))}
              </ul>
            </div>
            <p className="text-xs leading-relaxed text-ink-3">
              It will be redirected to{" "}
              <span className="break-all font-mono text-ink-2">{details.redirect_uri}</span> after your decision.
            </p>
          </div>

          <div className="mt-6 rounded bg-inverse p-4">
            <p className="text-sm leading-relaxed text-white/85">
              This agent will act as you, but every purchase is still limited by your delegation policy and may
              require your approval.
            </p>
          </div>

          <div className="mt-8 flex flex-wrap justify-end gap-3">
            <ArrowButton variant="inverse" size="md" disabled={deciding} onClick={() => decide(false)}>
              Deny
            </ArrowButton>
            <ArrowButton size="md" disabled={deciding} onClick={() => decide(true)}>
              {deciding ? "Working…" : "Approve"}
            </ArrowButton>
          </div>
        </>
      )}
    </div>
  );
}

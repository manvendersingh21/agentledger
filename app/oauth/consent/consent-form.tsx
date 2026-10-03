"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";

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
    <div className="w-full max-w-md rounded-lg border border-zinc-800 bg-zinc-950 p-6">
      {error && (
        <div>
          <h1 className="text-lg font-semibold text-zinc-50">Authorization unavailable</h1>
          <p className="mt-2 text-sm text-muted-foreground">{error}</p>
          <p className="mt-4 text-xs text-muted-foreground">
            The request may have expired or already been resolved. Closing this window is safe: denial is the
            default outcome.
          </p>
        </div>
      )}

      {!error && !details && (
        <p className="text-sm text-muted-foreground">Loading authorization request…</p>
      )}

      {!error && details && (
        <>
          <div className="flex items-center gap-3">
            {details.client.logo_uri ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={details.client.logo_uri}
                alt=""
                className="h-10 w-10 rounded-md border border-zinc-800 bg-zinc-900 object-contain"
              />
            ) : (
              <div className="flex h-10 w-10 items-center justify-center rounded-md border border-zinc-800 bg-zinc-900 font-mono text-sm text-zinc-400">
                {details.client.name.slice(0, 1).toUpperCase()}
              </div>
            )}
            <div>
              <h1 className="text-lg font-semibold leading-tight text-zinc-50">
                Authorize {details.client.name}
              </h1>
              <p className="text-xs text-muted-foreground">
                Signed in as {details.user.email}
              </p>
            </div>
          </div>

          <div className="mt-6 space-y-4 text-sm">
            <div>
              <h2 className="mb-2 font-medium text-zinc-200">This agent requests access to</h2>
              <ul className="space-y-1.5">
                {details.scope
                  .split(" ")
                  .filter(Boolean)
                  .map((scope) => (
                    <li key={scope} className="rounded border border-zinc-800 bg-zinc-900/50 px-3 py-1.5 font-mono text-xs text-zinc-300">
                      {scope}
                    </li>
                  ))}
              </ul>
            </div>
            <p className="text-xs text-muted-foreground">
              It will be redirected to{" "}
              <span className="font-mono text-zinc-400">{details.redirect_uri}</span> after your decision.
            </p>
          </div>

          <div className="mt-6 rounded-md border border-zinc-800 bg-zinc-900/40 p-4">
            <p className="text-sm text-zinc-300">
              This agent will act as you, but every purchase is still limited by your delegation policy and may
              require your approval.
            </p>
          </div>

          <div className="mt-6 flex justify-end gap-3">
            <Button variant="destructive" size="md" disabled={deciding} onClick={() => decide(false)}>
              Deny
            </Button>
            <Button variant="success" size="md" disabled={deciding} onClick={() => decide(true)}>
              {deciding ? "Working…" : "Approve"}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

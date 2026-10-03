import Link from "next/link";
import { ConsentForm } from "./consent-form";

export const metadata = {
  title: "Authorize agent — AgentLedger",
};

export default async function OAuthConsentPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const params = await searchParams;
  const raw = params.authorization_id;
  const authorizationId = Array.isArray(raw) ? raw[0] : raw;

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-zinc-950 px-4 py-12">
      <div className="mb-8 text-center">
        <Link href="/" className="text-sm font-semibold tracking-tight hover:underline">
          AgentLedger
        </Link>
        <p className="mt-2 text-sm text-muted-foreground">
          Agents propose. Policies decide. Humans stay in control.
        </p>
      </div>

      {authorizationId ? (
        <ConsentForm authorizationId={authorizationId} />
      ) : (
        <div className="w-full max-w-md rounded-lg border border-zinc-800 bg-zinc-950 p-6 text-sm text-muted-foreground">
          <h1 className="text-lg font-semibold text-zinc-50">Authorization request not found</h1>
          <p className="mt-2">
            This link is missing its <code className="font-mono text-xs">authorization_id</code>. Ask the agent to
            restart the connection flow.
          </p>
        </div>
      )}
    </div>
  );
}

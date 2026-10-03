import Link from "next/link";
import { ConsentForm } from "./consent-form";
import { Eyebrow } from "@/components/brand/eyebrow";
import { Wordmark } from "@/components/brand/wordmark";

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
    <div className="flex min-h-screen flex-col items-center justify-center bg-canvas px-4 py-12 font-sans text-ink">
      <div className="mb-8 flex flex-col items-center gap-3 text-center">
        <Link href="/" aria-label="AgentLedger home">
          <Wordmark />
        </Link>
        <p className="text-sm text-ink-2">Agents propose. Policies decide. Humans stay in control.</p>
      </div>

      {authorizationId ? (
        <ConsentForm authorizationId={authorizationId} />
      ) : (
        <div className="w-full max-w-md rounded-md border border-line bg-surface p-8 text-sm text-ink-2">
          <Eyebrow>Authorization</Eyebrow>
          <h1 className="mt-4 font-display text-3xl font-semibold leading-[0.95] tracking-[-0.045em] text-ink">
            Authorization request not found
          </h1>
          <p className="mt-4 leading-relaxed">
            This link is missing its <code className="font-mono text-xs text-ink">authorization_id</code>. Ask the
            agent to restart the connection flow.
          </p>
        </div>
      )}
    </div>
  );
}

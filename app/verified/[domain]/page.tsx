import Link from "next/link";
import { BadgeCheck, ShieldQuestion } from "lucide-react";
import { getPublicVerifiedByDomain } from "@/lib/registry/registry";
import { ArrowButton } from "@/components/brand/arrow-button";
import { Eyebrow } from "@/components/brand/eyebrow";
import { Wordmark } from "@/components/brand/wordmark";
import { formatDateTime } from "@/lib/utils";

export const dynamic = "force-dynamic";

interface VerifiedPageProps {
  params: Promise<{ domain: string }>;
}

const PILL = "inline-flex items-center rounded px-2.5 py-1 text-[11px] font-medium uppercase tracking-[0.12em]";

export default async function VerifiedDomainPage({ params }: VerifiedPageProps) {
  const { domain: rawDomain } = await params;
  const domain = decodeURIComponent(rawDomain).toLowerCase();
  const info = await getPublicVerifiedByDomain(domain);

  return (
    <div className="flex min-h-screen flex-col bg-canvas font-sans text-ink">
      <header className="px-4 pt-4 sm:px-6">
        <div className="mx-auto flex h-14 max-w-2xl items-center rounded-lg border border-line bg-surface px-5">
          <Link href="/" aria-label="AgentLedger home">
            <Wordmark />
          </Link>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center px-4 py-12 sm:px-6">
        <div className="mb-6 space-y-4">
          <Eyebrow>Merchant verification</Eyebrow>
          <h1 className="break-all font-display text-4xl font-semibold leading-[0.95] tracking-[-0.045em] sm:text-5xl">
            {info.domain}
          </h1>
        </div>

        <section
          className={
            info.verified
              ? "rounded-md bg-inverse p-8 text-white"
              : "rounded-md border border-line bg-surface p-8"
          }
        >
          <div className="flex items-start gap-4">
            {info.verified ? (
              <BadgeCheck className="h-8 w-8 shrink-0 text-accent-soft" aria-hidden />
            ) : (
              <ShieldQuestion className="h-8 w-8 shrink-0 text-ink-3" aria-hidden />
            )}
            <div className="space-y-3">
              <p className="font-display text-3xl font-semibold leading-none tracking-[-0.04em]">
                {info.verified ? "Verified by AgentLedger" : "Not verified"}
              </p>
              <div className="flex flex-wrap gap-2">
                {info.verified ? (
                  <span className={`${PILL} bg-executed-bg text-executed`}>Verified</span>
                ) : (
                  <span className={`${PILL} bg-[#F2F2F2] text-ink-2`}>Not verified</span>
                )}
                {info.isDemoFixture ? (
                  <span className={`${PILL} bg-approved-bg text-approved`}>Demo fixture</span>
                ) : null}
              </div>
            </div>
          </div>

          {info.companyName || info.verifiedAt ? (
            <dl
              className={`mt-8 grid gap-4 border-t pt-6 text-sm sm:grid-cols-2 ${
                info.verified ? "border-white/15" : "border-line"
              }`}
            >
              {info.companyName ? (
                <div>
                  <dt className={info.verified ? "text-white/60" : "text-ink-3"}>Company</dt>
                  <dd className="mt-1 font-medium">{info.companyName}</dd>
                </div>
              ) : null}
              {info.verifiedAt ? (
                <div>
                  <dt className={info.verified ? "text-white/60" : "text-ink-3"}>Verified at</dt>
                  <dd className="mt-1 font-mono">{formatDateTime(info.verifiedAt)}</dd>
                </div>
              ) : null}
            </dl>
          ) : null}
        </section>

        <p className="mt-6 text-sm leading-relaxed text-ink-2">
          Domain verification proves control of the hostname. It is not a safety rating — your delegation and
          guardrail policy still apply.
        </p>

        <div className="mt-8">
          <ArrowButton href="/" variant="secondary">
            AgentLedger home
          </ArrowButton>
        </div>
      </main>
    </div>
  );
}

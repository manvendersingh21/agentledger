import { Suspense } from "react";
import Link from "next/link";
import { LoginForm } from "./login-form";
import { Eyebrow } from "@/components/brand/eyebrow";
import { PixelGlobe } from "@/components/brand/pixel-globe";
import { Wordmark } from "@/components/brand/wordmark";

export default function LoginPage() {
  return (
    <div className="grid min-h-screen bg-canvas font-sans text-ink lg:grid-cols-2">
      <aside className="relative hidden flex-col justify-between overflow-hidden p-10 lg:flex">
        <Link href="/" aria-label="AgentLedger home" className="w-fit rounded-lg border border-line bg-surface px-4 py-3">
          <Wordmark />
        </Link>
        <div className="pointer-events-none absolute -right-24 top-1/2 -translate-y-1/2 opacity-90">
          <PixelGlobe size={520} />
        </div>
        <div className="relative max-w-md space-y-5">
          <Eyebrow>Authorization</Eyebrow>
          <h1 className="font-display text-5xl font-semibold leading-[0.95] tracking-[-0.045em]">
            Agents propose. Policies decide. <span className="text-accent">Humans</span> stay in control.
          </h1>
        </div>
      </aside>

      <main className="flex flex-col items-center justify-center px-4 py-12 sm:px-6">
        <div className="mb-8 lg:hidden">
          <Link href="/" aria-label="AgentLedger home">
            <Wordmark />
          </Link>
        </div>
        <div className="w-full max-w-md rounded-md border border-line bg-surface p-8">
          <div className="mb-8 space-y-3">
            <Eyebrow>Sign in</Eyebrow>
            <h2 className="font-display text-4xl font-semibold leading-[0.95] tracking-[-0.045em]">
              Welcome back.
            </h2>
            <p className="text-sm text-ink-2">Access your authorization and audit dashboard.</p>
          </div>
          <Suspense fallback={<p className="text-sm text-ink-3">Loading…</p>}>
            <LoginForm />
          </Suspense>
        </div>
        <p className="mt-6 text-xs text-ink-3">
          Deny always wins. Every action is audited.
        </p>
      </main>
    </div>
  );
}

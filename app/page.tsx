import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

function FlowNode({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={`rounded-md border border-border bg-card px-3 py-2 text-center text-xs font-medium text-foreground sm:text-sm ${className ?? ""}`}
    >
      {children}
    </div>
  );
}

function FlowArrow() {
  return (
    <div className="flex items-center justify-center text-muted-foreground" aria-hidden>
      <span className="hidden sm:inline">→</span>
      <span className="sm:hidden">↓</span>
    </div>
  );
}

export default function Home() {
  return (
    <div className="flex flex-1 flex-col">
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <span className="text-sm font-semibold tracking-tight">AgentLedger</span>
          <div className="flex gap-2">
            <Link href="/login" className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}>
              Sign in
            </Link>
            <Link href="/dashboard" className={cn(buttonVariants({ size: "sm" }))}>
              Open dashboard
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-16 px-6 py-16 md:py-24">
        <section className="max-w-3xl space-y-6">
          <h1 className="text-4xl font-semibold tracking-tight text-foreground md:text-5xl md:leading-tight">
            Give agents authority without giving them control.
          </h1>
          <p className="text-lg text-muted-foreground">
            AgentLedger evaluates, approves, executes, and audits consequential AI-agent actions.
          </p>
          <p className="text-sm font-medium text-foreground/80">
            Agents propose. Policies decide. Humans stay in control.
          </p>
          <div className="flex flex-wrap gap-3 pt-2">
            <Link href="/dashboard" className={cn(buttonVariants())}>
              Open dashboard
            </Link>
            <Link href="/login" className={cn(buttonVariants({ variant: "outline" }))}>
              Sign in
            </Link>
          </div>
        </section>

        <section className="space-y-4">
          <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Authorization flow
          </h2>
          <div className="rounded-lg border border-border bg-muted/20 p-4 sm:p-6">
            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-center sm:gap-3">
              <FlowNode>Human Principal</FlowNode>
              <FlowArrow />
              <FlowNode>Delegation</FlowNode>
              <FlowArrow />
              <FlowNode>Agent</FlowNode>
              <FlowArrow />
              <FlowNode>Action Intent</FlowNode>
              <FlowArrow />
              <FlowNode className="border-dashed">Deterministic Policy</FlowNode>
            </div>

            <div className="my-4 flex justify-center">
              <div className="h-6 w-px bg-border sm:hidden" />
            </div>

            <div className="flex flex-col items-center gap-2 sm:flex-row sm:flex-wrap sm:justify-center sm:gap-3">
              <FlowNode className="border-red-500/40 text-red-400">DENY</FlowNode>
              <FlowNode className="border-emerald-500/40 text-emerald-400">AUTO-APPROVE</FlowNode>
              <FlowNode className="border-amber-500/40 text-amber-400">REQUIRE HUMAN</FlowNode>
            </div>

            <div className="my-4 flex justify-center">
              <div className="flex flex-col items-center gap-1 text-muted-foreground">
                <span className="text-xs">approved path</span>
                <span>↓</span>
              </div>
            </div>

            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-center sm:gap-3">
              <FlowNode>Execution</FlowNode>
              <FlowArrow />
              <FlowNode>Receipt</FlowNode>
              <FlowArrow />
              <FlowNode className="font-mono text-[11px] sm:text-xs">
                Tamper-evident audit trail
              </FlowNode>
            </div>
          </div>
          <p className="text-sm text-muted-foreground">
            Every consequential action gets a principal, scope, policy, decision and receipt.
          </p>
        </section>
      </main>

      <footer className="border-t border-border py-6 text-center text-xs text-muted-foreground">
        The authorization and transaction layer for AI agents.
      </footer>
    </div>
  );
}

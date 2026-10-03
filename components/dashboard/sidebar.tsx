"use client";

import type React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ArrowDownRight,
  BadgeCheck,
  Bot,
  Boxes,
  ClipboardCheck,
  FileSearch,
  FlaskConical,
  LayoutDashboard,
  LayoutGrid,
  ShieldAlert,
  Link2,
  LogOut,
  Menu,
  MessageSquare,
  Receipt,
  X,
  Plug,
} from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { Wordmark } from "@/components/brand/wordmark";

const NAV_ITEMS = [
  { href: "/dashboard", label: "Overview", icon: LayoutDashboard, exact: true },
  { href: "/dashboard/concierge", label: "Concierge", icon: MessageSquare },
  { href: "/dashboard/agents", label: "Agent", icon: Bot },
  { href: "/dashboard/delegations", label: "Delegation", icon: Link2 },
  { href: "/dashboard/registry", label: "Registry", icon: BadgeCheck },
  { href: "/dashboard/approvals", label: "Approvals", icon: ClipboardCheck, badgeKey: "approvals" as const },
  { href: "/dashboard/transactions", label: "Transactions", icon: Receipt },
  { href: "/dashboard/audit", label: "Audit Trail", icon: FileSearch },
  { href: "/dashboard/inventory", label: "Inventory", icon: Boxes },
  { href: "/dashboard/scenarios", label: "Scenarios", icon: LayoutGrid },
  { href: "/dashboard/playground", label: "Playground", icon: FlaskConical },
  { href: "/dashboard/connect", label: "Connect", icon: Plug },
  { href: "/dashboard/attack-lab", label: "Attack Lab", icon: ShieldAlert },
];

export interface SidebarProps {
  email: string | null;
  pendingCount?: number;
  /** Optional page content; when given, the sidebar renders the full shell (top bar + nav + content). */
  children?: React.ReactNode;
}

export function Sidebar({ email, pendingCount = 0, children }: SidebarProps) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  function isActive(href: string, exact?: boolean) {
    if (exact) return pathname === href;
    return pathname === href || pathname.startsWith(`${href}/`);
  }

  const current = NAV_ITEMS.find((item) => isActive(item.href, item.exact)) ?? NAV_ITEMS[0];

  const navLink = (item: (typeof NAV_ITEMS)[number]) => {
    const active = isActive(item.href, item.exact);
    const Icon = item.icon;
    const showBadge = item.badgeKey === "approvals" && pendingCount > 0;

    return (
      <Link
        key={item.href}
        href={item.href}
        onClick={() => setMobileOpen(false)}
        aria-current={active ? "page" : undefined}
        className={cn(
          "group flex h-10 items-center gap-3 rounded px-3 text-[14px] font-medium transition-colors",
          active
            ? "bg-accent text-white"
            : "text-ink-2 hover:bg-accent-wash hover:text-accent",
        )}
      >
        <Icon
          className={cn(
            "size-4 shrink-0",
            active ? "text-white" : "text-ink-3 group-hover:text-accent",
          )}
        />
        <span className="flex-1 truncate">{item.label}</span>
        {showBadge ? (
          <span
            className={cn(
              "min-w-6 rounded-sm px-1.5 py-0.5 text-center font-mono text-[11px] font-semibold tabular-nums",
              active ? "bg-white text-accent" : "bg-waiting-bg text-waiting",
            )}
            aria-label={`${pendingCount} pending approvals`}
          >
            {pendingCount}
          </span>
        ) : null}
      </Link>
    );
  };

  const nav = (
    <div className="flex h-full flex-col">
      <p className="px-3 pb-2 pt-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-3">
        Workspace
      </p>
      <nav className="flex flex-col gap-0.5">{NAV_ITEMS.map(navLink)}</nav>
      <div className="mt-auto border-t border-line px-3 pt-4">
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-3">Signed in</p>
        <p className="mt-1 truncate text-[13px] text-ink-2" title={email ?? undefined}>
          {email ?? "Signed in"}
        </p>
        <form action="/auth/signout" method="post" className="mt-3 md:hidden">
          <button
            type="submit"
            className="inline-flex h-10 w-full items-center justify-center gap-2 rounded border border-line bg-surface text-[14px] font-medium text-ink hover:border-ink"
          >
            <LogOut className="size-4" />
            Sign out
          </button>
        </form>
      </div>
    </div>
  );

  return (
    <>
      {/* Floating pill top bar */}
      <div className="sticky top-0 z-40 px-2 pt-2 sm:px-3 sm:pt-3 md:px-6">
        <header className="mx-auto flex h-14 w-full max-w-[1440px] min-w-0 items-center gap-2 rounded-lg border border-line bg-surface px-2 shadow-[0_1px_0_rgba(0,0,0,0.02)] sm:gap-3 sm:px-3 md:px-4">
          <button
            type="button"
            className="inline-flex size-9 items-center justify-center rounded border border-line text-ink md:hidden"
            aria-label={mobileOpen ? "Close menu" : "Open menu"}
            aria-expanded={mobileOpen}
            onClick={() => setMobileOpen((o) => !o)}
          >
            {mobileOpen ? <X className="size-4" /> : <Menu className="size-4" />}
          </button>
          <Link
            href="/dashboard"
            className="flex min-w-0 shrink items-center overflow-hidden"
            aria-label="AgentLedger overview"
          >
            <Wordmark />
          </Link>
          <span className="hidden h-5 w-px bg-line sm:block" aria-hidden />
          <span className="hidden items-center gap-2 text-[14px] sm:flex">
            <span className="text-ink-3">Dashboard</span>
            <span className="text-ink-3">/</span>
            <span className="font-medium text-ink">{current.label}</span>
          </span>
          <div className="ml-auto flex items-center gap-3">
            {pendingCount > 0 ? (
              <Link
                href="/dashboard/approvals"
                className="hidden items-center gap-2 rounded-sm bg-waiting-bg px-2 py-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-waiting lg:inline-flex"
              >
                {pendingCount} awaiting approval
              </Link>
            ) : null}
            <span
              className="hidden max-w-[220px] truncate text-[13px] text-ink-2 md:block"
              title={email ?? undefined}
            >
              {email ?? "Signed in"}
            </span>
            <form action="/auth/signout" method="post" className="hidden md:block">
              <div className="flex items-stretch">
                <button
                  type="submit"
                  className="inline-flex h-10 items-center rounded-l bg-inverse px-4 text-[14px] font-medium text-white transition-colors hover:bg-ink"
                >
                  Sign out
                </button>
                <span
                  className="inline-flex size-10 items-center justify-center rounded-r border border-l-0 border-line bg-surface text-ink"
                  aria-hidden
                >
                  <ArrowDownRight className="size-4" />
                </span>
              </div>
            </form>
          </div>
        </header>
      </div>

      {mobileOpen ? (
        <div
          className="fixed inset-0 z-40 bg-ink/30 md:hidden"
          onClick={() => setMobileOpen(false)}
          aria-hidden
        />
      ) : null}

      <div className="mx-auto flex w-full max-w-[1440px] min-w-0 gap-4 px-2 pb-[max(3rem,env(safe-area-inset-bottom))] pt-3 sm:gap-6 sm:px-3 sm:pb-12 sm:pt-4 md:px-6 md:pt-6">
        <aside
          className={cn(
            "fixed bottom-2 left-2 right-2 top-[4.25rem] z-50 max-h-[calc(100dvh-5rem)] w-auto overflow-y-auto rounded-lg border border-line bg-surface p-3 transition-transform sm:bottom-3 sm:left-3 sm:right-auto sm:top-[76px] sm:w-64",
            "md:sticky md:top-[88px] md:z-auto md:h-[calc(100vh-112px)] md:w-60 md:max-h-none md:shrink-0 md:translate-x-0",
            mobileOpen ? "translate-x-0" : "-translate-x-[calc(100%+16px)] md:translate-x-0",
          )}
        >
          {nav}
        </aside>
        {children !== undefined ? <div className="min-w-0 flex-1">{children}</div> : null}
      </div>
    </>
  );
}

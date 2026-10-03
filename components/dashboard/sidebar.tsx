"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BadgeCheck,
  Bot,
  ClipboardCheck,
  FileSearch,
  FlaskConical,
  LayoutDashboard,
  ShieldAlert,
  Link2,
  Menu,
  Receipt,
  X,
} from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

const NAV_ITEMS = [
  { href: "/dashboard", label: "Overview", icon: LayoutDashboard, exact: true },
  { href: "/dashboard/agents", label: "Agent", icon: Bot },
  { href: "/dashboard/delegations", label: "Delegation", icon: Link2 },
  { href: "/dashboard/registry", label: "Registry", icon: BadgeCheck },
  { href: "/dashboard/approvals", label: "Approvals", icon: ClipboardCheck, badgeKey: "approvals" as const },
  { href: "/dashboard/transactions", label: "Transactions", icon: Receipt },
  { href: "/dashboard/audit", label: "Audit Trail", icon: FileSearch },
  { href: "/dashboard/playground", label: "Playground", icon: FlaskConical },
  { href: "/dashboard/attack-lab", label: "Attack Lab", icon: ShieldAlert },
];

function LedgerMark({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex size-7 shrink-0 items-center justify-center rounded border border-border bg-muted",
        className,
      )}
      aria-hidden
    >
      <span className="size-3.5 border border-foreground/70" />
    </span>
  );
}

export interface SidebarProps {
  email: string | null;
  pendingCount?: number;
}

export function Sidebar({ email, pendingCount = 0 }: SidebarProps) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  function isActive(href: string, exact?: boolean) {
    if (exact) return pathname === href;
    return pathname === href || pathname.startsWith(`${href}/`);
  }

  const navLink = (item: (typeof NAV_ITEMS)[number]) => {
    const active = isActive(item.href, item.exact);
    const Icon = item.icon;
    const showBadge = item.badgeKey === "approvals" && pendingCount > 0;

    return (
      <Link
        key={item.href}
        href={item.href}
        onClick={() => setMobileOpen(false)}
        className={cn(
          "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
          active
            ? "bg-muted text-foreground"
            : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
        )}
      >
        <Icon className="size-4 shrink-0 opacity-80" />
        <span className="flex-1">{item.label}</span>
        {showBadge ? (
          <span className="rounded-full bg-amber-500/20 px-2 py-0.5 text-xs font-medium text-amber-400">
            {pendingCount}
          </span>
        ) : null}
      </Link>
    );
  };

  const sidebarContent = (
    <>
      <div className="flex items-center gap-2.5 border-b border-border px-4 py-4">
        <LedgerMark />
        <span className="text-sm font-semibold tracking-tight">AgentLedger</span>
      </div>
      <nav className="flex flex-1 flex-col gap-0.5 p-3">{NAV_ITEMS.map(navLink)}</nav>
      <div className="border-t border-border p-4">
        <p className="truncate text-xs text-muted-foreground" title={email ?? undefined}>
          {email ?? "Signed in"}
        </p>
        <form action="/auth/signout" method="post" className="mt-3">
          <Button type="submit" variant="outline" size="sm" className="w-full">
            Sign out
          </Button>
        </form>
      </div>
    </>
  );

  return (
    <>
      <header className="flex items-center justify-between border-b border-border bg-card px-4 py-3 md:hidden">
        <Link href="/dashboard" className="flex items-center gap-2">
          <LedgerMark className="size-6" />
          <span className="text-sm font-semibold">AgentLedger</span>
        </Link>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={mobileOpen ? "Close menu" : "Open menu"}
          onClick={() => setMobileOpen((o) => !o)}
        >
          {mobileOpen ? <X className="size-5" /> : <Menu className="size-5" />}
        </Button>
      </header>

      {mobileOpen ? (
        <div
          className="fixed inset-0 z-40 bg-background/80 backdrop-blur-sm md:hidden"
          onClick={() => setMobileOpen(false)}
          aria-hidden
        />
      ) : null}

      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex w-64 flex-col border-r border-border bg-card transition-transform md:static md:z-auto md:translate-x-0",
          mobileOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0",
          "top-14 md:top-0",
        )}
      >
        {sidebarContent}
      </aside>
    </>
  );
}

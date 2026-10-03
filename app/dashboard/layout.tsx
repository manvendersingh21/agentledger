import type React from "react";
import { redirect } from "next/navigation";
import { KillSwitchBanner } from "@/components/dashboard/kill-switch-banner";
import { Sidebar } from "@/components/dashboard/sidebar";
import { getPrincipal } from "@/lib/auth/session";
import { getAgents } from "@/lib/data/queries";
import { createClient } from "@/lib/supabase/server";

async function getPendingApprovalCount(): Promise<number> {
  try {
    const db = await createClient();
    const { count } = await db
      .from("approvals")
      .select("id", { count: "exact", head: true })
      .eq("status", "pending");
    return count ?? 0;
  } catch {
    return 0;
  }
}

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const principal = await getPrincipal();
  if (!principal) {
    redirect("/login");
  }

  const [agents, pendingCount] = await Promise.all([getAgents(), getPendingApprovalCount()]);
  const suspendedAgents = agents
    .filter((a) => a.status === "suspended")
    .map((a) => ({
      id: a.id,
      name: a.name,
      suspended_at: a.suspended_at ?? null,
      suspended_reason: a.suspended_reason ?? null,
    }));

  return (
    <div className="min-h-screen bg-canvas font-sans text-ink">
      <KillSwitchBanner userId={principal.id} suspendedAgents={suspendedAgents} />
      <Sidebar email={principal.email} pendingCount={pendingCount}>
        <main className="mx-auto w-full max-w-7xl">{children}</main>
      </Sidebar>
    </div>
  );
}

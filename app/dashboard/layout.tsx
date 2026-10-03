import type React from "react";
import { redirect } from "next/navigation";
import { KillSwitchBanner } from "@/components/dashboard/kill-switch-banner";
import { Sidebar } from "@/components/dashboard/sidebar";
import { getPrincipal } from "@/lib/auth/session";
import { getAgents } from "@/lib/data/queries";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const principal = await getPrincipal();
  if (!principal) {
    redirect("/login");
  }

  const agents = await getAgents();
  const suspendedAgents = agents
    .filter((a) => a.status === "suspended")
    .map((a) => ({
      id: a.id,
      name: a.name,
      suspended_at: a.suspended_at ?? null,
      suspended_reason: a.suspended_reason ?? null,
    }));

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <Sidebar email={principal.email} pendingCount={0} />
      <div className="flex min-w-0 flex-1 flex-col overflow-auto">
        <KillSwitchBanner userId={principal.id} suspendedAgents={suspendedAgents} />
        <main className="flex-1">
          <div className="mx-auto w-full max-w-6xl p-6 md:p-8">{children}</div>
        </main>
      </div>
    </div>
  );
}

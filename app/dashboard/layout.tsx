import type React from "react";
import { redirect } from "next/navigation";
import { Sidebar } from "@/components/dashboard/sidebar";
import { getPrincipal } from "@/lib/auth/session";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const principal = await getPrincipal();
  if (!principal) {
    redirect("/login");
  }

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <Sidebar email={principal.email} pendingCount={0} />
      <main className="flex-1 overflow-auto">
        <div className="mx-auto w-full max-w-6xl p-6 md:p-8">{children}</div>
      </main>
    </div>
  );
}

import { Eyebrow } from "@/components/brand/eyebrow";
import { getPrincipal } from "@/lib/auth/session";
import { ensureSetup } from "@/lib/data/queries";
import { getMcpConnectionData } from "@/lib/data/connections";
import { ConnectClient } from "./connect-client";

export const dynamic = "force-dynamic";

function appBaseUrl(): string {
  return process.env.APP_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? "http://127.0.0.1:3000";
}

export default async function ConnectPage() {
  const principal = await getPrincipal();
  if (!principal) {
    return null;
  }

  await ensureSetup();
  const { events, agentNames } = await getMcpConnectionData();

  const supabaseUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://your-project.supabase.co").replace(
    /\/$/,
    "",
  );
  const appUrl = appBaseUrl().replace(/\/$/, "");
  const hostedMcpUrl = `${supabaseUrl}/functions/v1/mcp`;
  const localMcpUrl = `${appUrl}/api/mcp`;

  return (
    <div className="space-y-10">
      <header className="space-y-4">
        <Eyebrow>Integrations</Eyebrow>
        <h1 className="font-display text-[44px] font-semibold leading-[0.95] tracking-[-0.045em] text-ink sm:text-[56px]">
          Connect <span className="text-accent">any</span> agent.
        </h1>
        <p className="max-w-2xl text-base text-ink-2">
          Point Claude Code, Cursor, VS Code, or Claude Desktop at the live AgentLedger MCP server.
          OAuth signs the agent in as you; every tool call is bounded by your delegation policy.
        </p>
      </header>

      <ConnectClient
        userId={principal.id}
        appUrl={appUrl}
        hostedMcpUrl={hostedMcpUrl}
        localMcpUrl={localMcpUrl}
        initialEvents={events}
        agentNames={agentNames}
      />
    </div>
  );
}

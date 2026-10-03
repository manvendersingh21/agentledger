import { ensureSetup, getAgents } from "@/lib/data/queries";
import { formatDateTime } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CodeBlock } from "@/components/ui/code-block";
import { ReenableAgentButton } from "@/components/dashboard/kill-switch-banner";

export const dynamic = "force-dynamic";

function agentTypeLabel(type: string): string {
  if (type === "openai") return "OpenAI agent";
  if (type === "claude") return "Claude agent";
  return type;
}

export default async function AgentsPage() {
  await ensureSetup();
  const agents = await getAgents();
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://your-project.supabase.co";
  const mcpUrl = `${supabaseUrl.replace(/\/$/, "")}/functions/v1/mcp`;

  const mcpSnippet = {
    mcpServers: {
      agentledger: {
        url: mcpUrl,
      },
    },
  };

  return (
    <div className="space-y-8">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">Agents</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Agents authenticate as you (Supabase Auth) and can only propose actions; AgentLedger
          decides.
        </p>
      </header>

      <div className="grid gap-4 md:grid-cols-2">
        {agents.length === 0 ? (
          <p className="text-sm text-muted-foreground">No agents provisioned yet.</p>
        ) : (
          agents.map((agent) => (
            <Card key={agent.id}>
              <CardHeader>
                <div className="flex flex-wrap items-center gap-2">
                  <CardTitle className="text-base">{agent.name}</CardTitle>
                  <Badge variant="sky" className="normal-case tracking-normal">
                    {agentTypeLabel(agent.agent_type)}
                  </Badge>
                  <Badge
                    variant={
                      agent.status === "active"
                        ? "emerald"
                        : agent.status === "suspended"
                          ? "red"
                          : "neutral"
                    }
                    className="normal-case tracking-normal"
                  >
                    {agent.status}
                  </Badge>
                </div>
                <CardDescription>
                  Created {formatDateTime(agent.created_at)}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {agent.description ? (
                  <p className="text-sm text-muted-foreground">{agent.description}</p>
                ) : null}
                {agent.status === "suspended" ? (
                  <div className="space-y-2 rounded-md border border-red-500/40 bg-red-500/5 px-3 py-2">
                    <p className="text-sm font-medium text-red-400">Kill switch active</p>
                    <p className="text-xs text-red-200/90">
                      {agent.suspended_reason?.trim() || "Agent halted by guardrails"}
                      {agent.suspended_at ? ` · ${formatDateTime(agent.suspended_at)}` : null}
                    </p>
                    <ReenableAgentButton agentId={agent.id} />
                  </div>
                ) : null}
                <p className="font-mono text-xs text-muted-foreground">{agent.id}</p>
              </CardContent>
            </Card>
          ))
        )}
      </div>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold">MCP connection</h2>
        <p className="text-sm text-muted-foreground">
          Point Claude Desktop or another MCP client at the AgentLedger edge server. OAuth uses your
          Supabase session — the authenticated user is always the principal.
        </p>
        <CodeBlock value={mcpSnippet} title="claude_desktop_config.json" />
      </section>
    </div>
  );
}

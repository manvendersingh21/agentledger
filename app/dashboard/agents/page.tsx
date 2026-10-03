import { ensureSetup, getAgents } from "@/lib/data/queries";
import { formatDateTime } from "@/lib/utils";
import { Bot, ShieldAlert } from "lucide-react";
import { CodeBlock } from "@/components/ui/code-block";
import { ReenableAgentButton } from "@/components/dashboard/kill-switch-banner";
import { Eyebrow } from "@/components/brand/eyebrow";
import { cn } from "@/lib/utils";

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
    <div className="space-y-10">
      <header className="space-y-4">
        <Eyebrow>Principals</Eyebrow>
        <h1 className="font-display text-[44px] font-semibold leading-[0.95] tracking-[-0.045em] text-ink sm:text-[56px]">
          Agents
        </h1>
        <p className="max-w-2xl text-base text-ink-2">
          Agents authenticate as you (Supabase Auth) and can only propose actions; AgentLedger
          decides.
        </p>
      </header>

      {agents.length === 0 ? (
        <p className="rounded-[6px] border border-line bg-surface px-6 py-12 text-center text-sm text-ink-2">
          No agents provisioned yet.
        </p>
      ) : (
        <div className="grid gap-6 md:grid-cols-2">
          {agents.map((agent) => {
            const statusClass =
              agent.status === "active"
                ? "bg-executed-bg text-executed"
                : agent.status === "suspended"
                  ? "bg-blocked-bg text-blocked"
                  : "bg-[#F2F2F2] text-ink-2";
            return (
              <article
                key={agent.id}
                className="flex flex-col gap-6 rounded-[6px] border border-line bg-surface p-6 sm:p-8"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-center gap-4">
                    <span className="inline-flex size-12 shrink-0 items-center justify-center rounded-[6px] bg-accent-wash text-accent">
                      <Bot className="size-6" />
                    </span>
                    <div className="space-y-1">
                      <h2 className="font-display text-2xl font-semibold leading-none tracking-[-0.045em] text-ink">
                        {agent.name}
                      </h2>
                      <p className="text-sm text-ink-3">
                        {agentTypeLabel(agent.agent_type)} · Created{" "}
                        {formatDateTime(agent.created_at)}
                      </p>
                    </div>
                  </div>
                  <span
                    className={cn(
                      "inline-flex shrink-0 items-center rounded-[4px] px-2 py-1 text-[11px] font-semibold uppercase tracking-[0.08em]",
                      statusClass,
                    )}
                  >
                    {agent.status}
                  </span>
                </div>

                {agent.description ? (
                  <p className="text-[15px] leading-relaxed text-ink-2">{agent.description}</p>
                ) : null}

                {agent.status === "suspended" ? (
                  <div className="space-y-3 rounded-[6px] bg-inverse p-5 text-white">
                    <p className="flex items-center gap-2 text-sm font-semibold">
                      <ShieldAlert className="size-4 text-blocked" />
                      Kill switch active
                    </p>
                    <p className="text-xs text-white/60">
                      {agent.suspended_reason?.trim() || "Agent halted by guardrails"}
                      {agent.suspended_at ? ` · ${formatDateTime(agent.suspended_at)}` : null}
                    </p>
                    <ReenableAgentButton agentId={agent.id} />
                  </div>
                ) : null}

                <div className="mt-auto border-t border-line pt-4">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-3">
                    Agent ID
                  </p>
                  <p className="mt-1 break-all font-mono text-xs text-ink-2">{agent.id}</p>
                </div>
              </article>
            );
          })}
        </div>
      )}

      <section className="grid gap-8 rounded-[6px] border border-line bg-surface p-6 sm:p-8 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <div className="space-y-4">
          <Eyebrow>MCP</Eyebrow>
          <h2 className="font-display text-3xl font-semibold leading-[0.95] tracking-[-0.045em] text-ink sm:text-4xl">
            Connect over <span className="text-accent">MCP</span>
          </h2>
          <p className="text-[15px] leading-relaxed text-ink-2">
            Point Claude Desktop or another MCP client at the AgentLedger edge server. OAuth uses
            your Supabase session — the authenticated user is always the principal.
          </p>
        </div>
        <CodeBlock value={mcpSnippet} title="claude_desktop_config.json" className="min-w-0" />
      </section>
    </div>
  );
}

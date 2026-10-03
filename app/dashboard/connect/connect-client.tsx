"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Check, Copy, Plug } from "lucide-react";
import { Eyebrow } from "@/components/brand/eyebrow";
import { CodeBlock } from "@/components/ui/code-block";
import { LocalDateTime } from "@/components/local-time";
import type { AuditEventRow } from "@/lib/data/types";
import {
  MCP_LIVE_THRESHOLD_MS,
  aggregateMcpSessions,
  mergeMcpAuditEvent,
} from "@/lib/data/mcp-sessions";
import { useLedgerRealtime } from "@/lib/realtime/use-ledger-realtime";
import { cn } from "@/lib/utils";

const EXAMPLE_PROMPT =
  "Using the agentledger tools, find the cheapest API plan with at least 100,000 requests under $20 and buy one month. No subscriptions.";

const PILL =
  "inline-flex items-center rounded-[4px] px-2 py-1 text-[11px] font-semibold uppercase tracking-[0.08em]";

interface ConnectClientProps {
  userId: string;
  appUrl: string;
  hostedMcpUrl: string;
  localMcpUrl: string;
  initialEvents: AuditEventRow[];
  agentNames: Record<string, string>;
}

function rowFromRecord(record: Record<string, unknown>): AuditEventRow | null {
  const id = typeof record.id === "string" ? record.id : null;
  if (!id) return null;
  return {
    id,
    principal_id: String(record.principal_id ?? ""),
    agent_id: record.agent_id != null ? String(record.agent_id) : null,
    intent_id: record.intent_id != null ? String(record.intent_id) : null,
    event_type: String(record.event_type ?? ""),
    event_data: (record.event_data as Record<string, unknown>) ?? {},
    previous_hash: String(record.previous_hash ?? ""),
    event_hash: String(record.event_hash ?? ""),
    created_at: String(record.created_at ?? new Date().toISOString()),
  };
}

function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <button
      type="button"
      onClick={() => void handleCopy()}
      className="inline-flex h-9 items-center gap-2 rounded-[4px] border border-line bg-surface px-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-2 transition-colors hover:border-ink-3 hover:text-ink"
    >
      {copied ? <Check className="size-3.5 text-executed" /> : <Copy className="size-3.5" />}
      {copied ? "Copied" : label}
    </button>
  );
}

function IntegrationCard({
  title,
  description,
  children,
  copyText,
  copyLabel,
}: {
  title: string;
  description: string;
  children: ReactNode;
  copyText: string;
  copyLabel?: string;
}) {
  return (
    <article className="flex flex-col gap-4 rounded-[6px] border border-line bg-surface p-5 sm:p-6">
      <div className="space-y-2">
        <h3 className="font-display text-xl font-semibold tracking-[-0.03em] text-ink">{title}</h3>
        <p className="text-[14px] leading-relaxed text-ink-2">{description}</p>
      </div>
      <div className="min-w-0 flex-1">{children}</div>
      <div className="flex justify-end border-t border-line pt-4">
        <CopyButton text={copyText} label={copyLabel} />
      </div>
    </article>
  );
}

export function ConnectClient({
  userId,
  appUrl,
  hostedMcpUrl,
  localMcpUrl,
  initialEvents,
  agentNames: initialAgentNames,
}: ConnectClientProps) {
  const [events, setEvents] = useState(initialEvents);
  const [agentNames, setAgentNames] = useState(initialAgentNames);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const id = window.setInterval(() => setTick((n) => n + 1), 15_000);
    return () => window.clearInterval(id);
  }, []);

  const onChange = useCallback(
    (change: { table: string; operation: string; record: Record<string, unknown> | null }) => {
      if (change.table !== "audit_events" || change.operation !== "INSERT" || !change.record) {
        return;
      }
      const row = rowFromRecord(change.record);
      if (!row) return;
      setEvents((prev) => mergeMcpAuditEvent(prev, row));
      if (row.agent_id) {
        setAgentNames((prev) =>
          prev[row.agent_id!] ? prev : { ...prev, [row.agent_id!]: "MCP agent" },
        );
      }
    },
    [],
  );

  useLedgerRealtime(userId, onChange);

  const sessions = useMemo(() => {
    void tick;
    return aggregateMcpSessions(events, agentNames, new Date());
  }, [events, agentNames, tick]);

  const claudeCodeCmd = `claude mcp add --transport http agentledger ${hostedMcpUrl}`;
  const claudeCodeLocalCmd = `claude mcp add --transport http agentledger ${localMcpUrl}`;

  const cursorMcpJson = {
    mcpServers: {
      agentledger: {
        url: hostedMcpUrl,
      },
    },
  };

  const vscodeMcpJson = {
    servers: {
      agentledger: {
        type: "http",
        url: hostedMcpUrl,
      },
    },
  };

  const liveCount = sessions.filter((s) => s.live).length;

  return (
    <div className="space-y-12">
      <section className="space-y-6">
        <div className="space-y-2">
          <Eyebrow>MCP endpoints</Eyebrow>
          <h2 className="font-display text-3xl font-semibold leading-[0.95] tracking-[-0.045em] text-ink sm:text-4xl">
            One-click <span className="text-accent">setup</span>
          </h2>
          <p className="max-w-3xl text-[15px] text-ink-2">
            Production clients should use the hosted Supabase edge function. For local development, use
            the Next.js route on your machine (same tools, same OAuth against your Supabase project).
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-[6px] border border-line bg-accent-wash/40 p-4">
            <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-accent">Hosted (production)</p>
            <p className="mt-2 break-all font-mono text-xs text-ink">{hostedMcpUrl}</p>
          </div>
          <div className="rounded-[6px] border border-line bg-surface p-4">
            <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-ink-3">Local dev</p>
            <p className="mt-2 break-all font-mono text-xs text-ink-2">{localMcpUrl}</p>
          </div>
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          <IntegrationCard
            title="Claude Code"
            description="Adds AgentLedger as an HTTP MCP server. Complete Supabase OAuth when prompted."
            copyText={claudeCodeCmd}
            copyLabel="Copy command"
          >
            <CodeBlock value={claudeCodeCmd} title="Terminal" />
            <p className="mt-3 text-[12px] text-ink-3">
              Local:{" "}
              <code className="font-mono text-[11px] text-ink-2">{claudeCodeLocalCmd}</code>
            </p>
          </IntegrationCard>

          <IntegrationCard
            title="Cursor"
            description="Save as .cursor/mcp.json in your project (or merge into global MCP settings)."
            copyText={JSON.stringify(cursorMcpJson, null, 2)}
            copyLabel="Copy JSON"
          >
            <CodeBlock value={cursorMcpJson} title=".cursor/mcp.json" />
          </IntegrationCard>

          <IntegrationCard
            title="Claude Desktop / claude.ai"
            description="Custom connector: paste the hosted MCP URL. Sign in with the same Supabase account as this dashboard."
            copyText={hostedMcpUrl}
            copyLabel="Copy URL"
          >
            <div className="rounded-[4px] border border-line bg-[#F7F7F7] p-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-ink-3">Connector URL</p>
              <p className="mt-2 break-all font-mono text-xs text-ink">{hostedMcpUrl}</p>
            </div>
          </IntegrationCard>

          <IntegrationCard
            title="VS Code"
            description="Workspace MCP config at .vscode/mcp.json (VS Code 1.99+ MCP support)."
            copyText={JSON.stringify(vscodeMcpJson, null, 2)}
            copyLabel="Copy JSON"
          >
            <CodeBlock value={vscodeMcpJson} title=".vscode/mcp.json" />
          </IntegrationCard>
        </div>
      </section>

      <section className="grid gap-8 rounded-[6px] border border-line bg-surface p-6 sm:p-8 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <div className="space-y-4">
          <Eyebrow>Identity</Eyebrow>
          <h2 className="font-display text-3xl font-semibold leading-[0.95] tracking-[-0.045em] text-ink sm:text-4xl">
            How <span className="text-accent">auth</span> works
          </h2>
          <ul className="space-y-3 text-[15px] leading-relaxed text-ink-2">
            <li>
              <strong className="font-medium text-ink">OAuth 2.1 via Supabase Auth</strong> — MCP clients
              discover your app&apos;s protected resource metadata and complete the authorization code flow.
            </li>
            <li>
              <strong className="font-medium text-ink">Dynamic client registration</strong> — Claude Code,
              Cursor, and other clients can register without a manual client ID.
            </li>
            <li>
              <strong className="font-medium text-ink">Consent screen</strong> — you approve scopes on the{" "}
              <Link href="/oauth/consent" className="text-accent hover:text-accent-hover hover:underline">
                OAuth consent page
              </Link>{" "}
              before tools run.
            </li>
            <li>
              <strong className="font-medium text-ink">Delegation-bound actions</strong> — the agent acts as
              you, but purchases and searches are limited by your active delegation, policy engine, and
              guardrails — not by model claims.
            </li>
          </ul>
        </div>
        <div className="space-y-4">
          <CodeBlock
            title="Protected resource"
            value={`${appUrl}/.well-known/oauth-protected-resource\nresource: ${localMcpUrl}`}
          />
          <p className="text-[13px] text-ink-3">
            First successful tool call writes an <span className="font-mono text-ink-2">AGENT_AUTHENTICATED</span>{" "}
            audit event with <span className="font-mono text-ink-2">channel: mcp</span> — that powers the live panel
            below.
          </p>
        </div>
      </section>

      <section className="rounded-[6px] border border-line bg-surface">
        <div className="flex flex-wrap items-end justify-between gap-4 border-b border-line px-5 py-5 md:px-6">
          <div>
            <Eyebrow>Realtime</Eyebrow>
            <h2 className="mt-2 font-display text-[28px] font-semibold leading-[0.95] tracking-[-0.045em] text-ink md:text-[32px]">
              Connected <span className="text-accent">agents</span>
            </h2>
            <p className="mt-2 text-[13px] text-ink-3">
              MCP sessions from audit events · Live if seen in the last{" "}
              {Math.round(MCP_LIVE_THRESHOLD_MS / 60_000)} minutes
            </p>
          </div>
          <div className="flex items-center gap-3">
            {liveCount > 0 ? (
              <div
                className={cn(
                  PILL,
                  "gap-2 bg-executed-bg text-executed",
                )}
              >
                <span className="relative flex size-2">
                  <span className="absolute inline-flex size-full animate-ping rounded-full bg-executed opacity-40 motion-reduce:animate-none" />
                  <span className="relative inline-flex size-2 rounded-full bg-executed" />
                </span>
                {liveCount} live
              </div>
            ) : (
              <span className={cn(PILL, "bg-[#F2F2F2] text-ink-2")}>Waiting for MCP</span>
            )}
          </div>
        </div>

        {sessions.length === 0 ? (
          <div className="flex flex-col items-center gap-3 px-6 py-14 text-center">
            <span className="inline-flex size-12 items-center justify-center rounded-[6px] bg-accent-wash text-accent">
              <Plug className="size-6" />
            </span>
            <p className="max-w-md text-[15px] text-ink-2">
              No MCP sessions yet. Run the Claude Code command above, complete OAuth, then invoke any
              AgentLedger tool — this panel updates instantly.
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-line">
            {sessions.map((session) => (
              <li
                key={session.sessionId}
                className="flex flex-wrap items-center gap-4 px-5 py-4 md:px-6"
              >
                <div className="min-w-0 flex-1 space-y-1">
                  <p className="font-display text-lg font-semibold tracking-[-0.02em] text-ink">
                    {session.agentName}
                  </p>
                  <p className="font-mono text-[12px] text-ink-3">
                    Session {session.sessionId.slice(0, 8)}…
                    {session.agentId ? ` · agent ${session.agentId.slice(0, 8)}…` : null}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-4 text-[13px] text-ink-2">
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-ink-3">Last seen</p>
                    <LocalDateTime iso={session.lastSeenAt} className="font-mono text-[12px] text-ink" />
                  </div>
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-ink-3">Tool calls</p>
                    <p className="font-mono text-[12px] tabular-nums text-ink">{session.toolCallCount}</p>
                  </div>
                  {session.live ? (
                    <span className={cn(PILL, "gap-1.5 bg-executed-bg text-executed")}>
                      <span className="size-1.5 rounded-full bg-executed" />
                      Live
                    </span>
                  ) : (
                    <span className={cn(PILL, "bg-[#F2F2F2] text-ink-2")}>Idle</span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}

        <div className="flex items-center gap-2 border-t border-line px-5 py-3 text-[12px] text-ink-3 md:px-6">
          <span className="relative flex size-2">
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-accent opacity-40 motion-reduce:animate-none" />
            <span className="relative inline-flex size-2 rounded-full bg-accent" />
          </span>
          Subscribed to audit_events on your private realtime channel
        </div>
      </section>

      <section className="rounded-[6px] border border-line bg-inverse p-6 text-white sm:p-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-xl space-y-3">
            <Eyebrow className="text-accent-soft">Demo prompt</Eyebrow>
            <h2 className="font-display text-2xl font-semibold leading-[0.95] tracking-[-0.045em] sm:text-3xl">
              Paste into your external agent
            </h2>
            <p className="text-sm text-white/65">
              Exercises search, policy, and purchase tools against the demo catalog — ideal for stage demos.
            </p>
          </div>
          <CopyButton text={EXAMPLE_PROMPT} label="Copy prompt" />
        </div>
        <p className="mt-6 rounded-[4px] border border-white/10 bg-white/5 p-4 font-mono text-[13px] leading-relaxed text-white/90">
          {EXAMPLE_PROMPT}
        </p>
      </section>
    </div>
  );
}

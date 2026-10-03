import { z } from "zod";
import { getDomainContext } from "@/lib/domain/server-context";
import { appendAuditEvent } from "@/lib/domain/audit";
import { getAgentProvider } from "@/lib/agent";
import { bindAgentTools } from "@/lib/agent/bind-tools";
import type { AgentActivity } from "@/lib/agent/types";
import { errorResponse, unauthorized } from "@/lib/domain/http";

export const runtime = "nodejs";
export const maxDuration = 120;

const Body = z.object({ prompt: z.string().trim().min(3).max(2000), compromised: z.boolean().default(false) });

/** Runs the embedded purchasing agent and streams its activity as NDJSON. */
export async function POST(request: Request) {
  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await request.json());
  } catch (error) {
    return errorResponse(error);
  }
  const session = await getDomainContext("playground").catch(() => null);
  if (!session) return unauthorized();
  const provider = getAgentProvider();
  if (!provider) {
    return Response.json({ error: "AGENT_UNAVAILABLE", message: "OPENAI_API_KEY is not configured on the server." }, { status: 503 });
  }
  const { ctx } = session;

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (a: AgentActivity) => controller.enqueue(encoder.encode(JSON.stringify(a) + "\n"));
      try {
        await appendAuditEvent(ctx.db, {
          principalId: ctx.principalId,
          agentId: ctx.agentId,
          eventType: "AGENT_AUTHENTICATED",
          eventData: { channel: "playground", provider: provider.name, model: provider.model, red_team_compromised: body.compromised },
        });
        const result = await provider.runAgent({
          prompt: body.prompt,
          compromised: body.compromised,
          tools: bindAgentTools(ctx),
          onActivity: send,
          abortSignal: request.signal,
        });
        send({ type: "done", text: result.text, steps: result.steps });
      } catch (error) {
        console.error("[agent] run failed", error);
        send({ type: "error", message: error instanceof Error ? error.message.slice(0, 300) : "Agent run failed" });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson", "Cache-Control": "no-store" } });
}

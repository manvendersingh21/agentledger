import { CONCIERGE_CHAT_BODY, runConcierge, type ConciergeActivity } from "@/lib/agent/concierge";
import { getDomainContext } from "@/lib/domain/server-context";
import { appendAuditEvent } from "@/lib/domain/audit";
import { serverEnv } from "@/lib/env";
import { errorResponse, unauthorized } from "@/lib/domain/http";

export const runtime = "nodejs";
export const maxDuration = 120;

/** Multi-turn concierge chat — client sends message history; streams NDJSON activity. */
export async function POST(request: Request) {
  const session = await getDomainContext("concierge").catch(() => null);
  if (!session) return unauthorized();

  const apiKey = serverEnv.openaiApiKey();
  if (!apiKey) {
    return Response.json(
      { error: "AGENT_UNAVAILABLE", message: "OPENAI_API_KEY is not configured on the server." },
      { status: 503 },
    );
  }

  let body: ReturnType<typeof CONCIERGE_CHAT_BODY.parse>;
  try {
    body = CONCIERGE_CHAT_BODY.parse(await request.json());
  } catch (error) {
    return errorResponse(error);
  }

  const model = serverEnv.agentModel();
  const { ctx } = session;

  const encoder = new TextEncoder();
  // The client aborts superseded turns, so the stream is routinely cancelled mid-write;
  // enqueue/close on a cancelled controller throws and must not crash the handler.
  let closed = false;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (a: ConciergeActivity) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(a)}\n`));
        } catch {
          closed = true; // client disconnected; stop writing
        }
      };
      try {
        await appendAuditEvent(ctx.db, {
          principalId: ctx.principalId,
          agentId: ctx.agentId,
          eventType: "AGENT_AUTHENTICATED",
          eventData: { channel: "concierge", provider: "openai", model, message_count: body.messages.length },
        });
        const result = await runConcierge({
          ctx,
          messages: body.messages,
          model,
          apiKey,
          onActivity: send,
          abortSignal: request.signal,
        });
        send({ type: "done", text: result.text, steps: result.steps });
        if (result.awaitingUser) {
          send({ type: "status", message: "awaiting_user_input" });
        }
      } catch (error) {
        console.error("[concierge] chat failed", error);
        send({
          type: "error",
          message: error instanceof Error ? error.message.slice(0, 300) : "Concierge request failed",
        });
      } finally {
        if (!closed) {
          closed = true;
          try {
            controller.close();
          } catch {
            // already closed/errored
          }
        }
      }
    },
    cancel() {
      closed = true;
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson", "Cache-Control": "no-store" },
  });
}

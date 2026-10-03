import { z } from "zod";
import {
  ensurePrincipalSetup,
  getActionStatus,
  proposePurchase,
  searchProducts,
  type DomainContext,
} from "@/lib/domain/pipeline";
import { serverEnv } from "@/lib/env";
import { createPaymentProvider } from "@/lib/payments/provider";
import { createAdminClient } from "@/lib/supabase/admin";

const searchProductsInput = z.object({
  query: z.string().trim().max(200),
});

const proposePurchaseInput = z.object({
  product_id: z.string().uuid(),
  quantity: z.number().int().min(1).max(1).optional(),
  reason: z.string().max(1000).optional(),
  idempotency_key: z.string().min(8).max(200).optional(),
});

const actionStatusInput = z.object({
  intent_id: z.string().uuid(),
});

type SupportedAction =
  | "searchProducts"
  | "proposePurchase"
  | "getActionStatus";

function supportedAction(value: string): value is SupportedAction {
  return (
    value === "searchProducts" ||
    value === "proposePurchase" ||
    value === "getActionStatus"
  );
}

function unauthorized() {
  return Response.json(
    {
      error: "UNAUTHENTICATED",
      message: "Valid Supabase Bearer access token required.",
    },
    {
      status: 401,
      headers: { "WWW-Authenticate": "Bearer" },
    },
  );
}

async function domainContext(
  request: Request,
): Promise<DomainContext | null> {
  const match = request.headers
    .get("authorization")
    ?.match(/^Bearer\s+(.+)$/i);
  const token = match?.[1]?.trim();
  if (!token) return null;

  const db = createAdminClient();
  const { data, error } = await db.auth.getUser(token);
  if (error || !data.user) return null;

  const displayName = data.user.email ?? "AgentLedger user";
  const agentId = await ensurePrincipalSetup(db, data.user.id, displayName);
  return {
    db,
    principalId: data.user.id,
    agentId,
    payments: createPaymentProvider({
      preferred: serverEnv.paymentProvider(),
      stripeSecretKey: serverEnv.stripeSecretKey(),
    }),
    channel: "chatgpt_action",
    jevApiKey: serverEnv.jevApiKey(),
  };
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ action: string }> },
) {
  const { action } = await params;
  if (!supportedAction(action)) {
    return Response.json(
      { error: "NOT_FOUND", message: `Unknown GPT action: ${action}` },
      { status: 404 },
    );
  }

  const context = await domainContext(request);
  if (!context) return unauthorized();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json(
      { error: "INVALID_JSON", message: "Request body must be valid JSON." },
      { status: 400 },
    );
  }

  try {
    switch (action) {
      case "searchProducts": {
        const input = searchProductsInput.parse(body);
        return Response.json(await searchProducts(context, input.query));
      }
      case "proposePurchase": {
        const input = proposePurchaseInput.parse(body);
        return Response.json(await proposePurchase(context, input));
      }
      case "getActionStatus": {
        const input = actionStatusInput.parse(body);
        return Response.json(
          await getActionStatus(context, input.intent_id),
        );
      }
    }
  } catch (error) {
    if (error instanceof z.ZodError) {
      return Response.json(
        {
          error: "INVALID_INPUT",
          message: error.issues.map((issue) => issue.message).join("; "),
        },
        { status: 400 },
      );
    }
    console.error(
      JSON.stringify({
        at: new Date().toISOString(),
        scope: "agentledger:gpt-action",
        action,
        message: "action failed",
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    return Response.json(
      {
        error: "INTERNAL_ERROR",
        message: "AgentLedger could not safely process this action.",
      },
      { status: 500 },
    );
  }
}

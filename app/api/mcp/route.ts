import { NextResponse } from "next/server";
import { handleMcpRequest } from "@/lib/mcp/tools";
import { ensurePrincipalSetup } from "@/lib/domain/pipeline";
import { createPaymentProvider } from "@/lib/payments/provider";
import { createAdminClient } from "@/lib/supabase/admin";
import { serverEnv } from "@/lib/env";

function appUrl(): string {
  return process.env.APP_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? "http://127.0.0.1:3000";
}

function unauthorizedResponse() {
  const metadata = `${appUrl()}/.well-known/oauth-protected-resource`;
  return NextResponse.json(
    { error: "UNAUTHENTICATED", message: "Valid Bearer access token required." },
    {
      status: 401,
      headers: {
        "WWW-Authenticate": `Bearer resource_metadata="${metadata}"`,
      },
    },
  );
}

async function domainContextFromToken(token: string) {
  const db = createAdminClient();
  const { data, error } = await db.auth.getUser(token);
  if (error || !data.user) return null;
  const principalId = data.user.id;
  const displayName = data.user.email ?? "AgentLedger user";
  const agentId = await ensurePrincipalSetup(db, principalId, displayName);
  const payments = createPaymentProvider({
    preferred: serverEnv.paymentProvider(),
    stripeSecretKey: serverEnv.stripeSecretKey(),
  });
  return {
    domain: { db, principalId, agentId, payments, channel: "mcp", jevApiKey: process.env.JEV_API_KEY ?? null },
    principalLabel: displayName,
  };
}

export async function GET() {
  return NextResponse.json({ error: "METHOD_NOT_ALLOWED", message: "Use POST for MCP JSON-RPC." }, { status: 405 });
}

export async function POST(request: Request) {
  const auth = request.headers.get("authorization");
  const match = auth?.match(/^Bearer\s+(.+)$/i);
  const token = match?.[1]?.trim();
  if (!token) return unauthorizedResponse();

  const session = await domainContextFromToken(token);
  if (!session) return unauthorizedResponse();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } },
      { status: 400 },
    );
  }

  const response = await handleMcpRequest(body, session);
  if (response === null) {
    return new NextResponse(null, { status: 204 });
  }
  return NextResponse.json(response);
}

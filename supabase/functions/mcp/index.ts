// AgentLedger MCP server (Supabase Edge Function, Deno).
//
// Authentication: Supabase Auth OAuth 2.1 (RFC 9728 protected-resource metadata is served by
// withOAuthProtectedResource; withSupabase gates every request on a valid user JWT). The
// authenticated human user IS the principal — identity is never taken from tool arguments.
//
// Tool definitions and JSON-RPC handling live in lib/mcp/tools.ts (shared with Next.js /api/mcp).
import { pipeline } from "npm:@supabase/middleware@1";
import { withOAuthProtectedResource, withSupabase } from "npm:@supabase/server@1";
import { createClient } from "@supabase/supabase-js";
import { handleMcpRequest } from "../../../lib/mcp/tools.ts";
import { ensurePrincipalSetup } from "../../../lib/domain/pipeline.ts";
import { createPaymentProvider } from "../../../lib/payments/provider.ts";

function log(message: string, fields: Record<string, unknown> = {}) {
  console.log(JSON.stringify({ at: new Date().toISOString(), scope: "agentledger:mcp", message, ...fields }));
}

function serviceRoleKey(): string {
  return (
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ??
    Deno.env.get("SUPABASE_SECRET_KEY") ??
    Deno.env.get("SB_SECRET_KEY") ??
    ""
  );
}

Deno.serve(
  pipeline(
    [withOAuthProtectedResource(), withSupabase({ auth: "user" })],
    async (req, ctx) => {
      if (req.method === "GET") {
        return Response.json({ error: "METHOD_NOT_ALLOWED", message: "Use POST for MCP JSON-RPC." }, { status: 405 });
      }
      if (req.method !== "POST") {
        return Response.json({ error: "METHOD_NOT_ALLOWED" }, { status: 405 });
      }

      const principalId = ctx.userClaims?.id;
      if (!principalId) {
        return Response.json({ error: "unauthenticated" }, { status: 401 });
      }
      const { data: userData } = await ctx.supabase.auth.getUser();
      const displayName = userData.user?.email ?? "AgentLedger user";

      const url = Deno.env.get("SUPABASE_URL");
      const key = serviceRoleKey();
      if (!url || !key) {
        log("missing SUPABASE_URL or service-role key in environment", { has_url: Boolean(url) });
        return Response.json({ error: "server misconfigured" }, { status: 500 });
      }
      const db = createClient(url, key, {
        auth: { persistSession: false, autoRefreshToken: false },
      });

      const agentId = await ensurePrincipalSetup(db, principalId, displayName);
      const domain = {
        db,
        principalId,
        agentId,
        payments: createPaymentProvider({
          preferred: Deno.env.get("PAYMENT_PROVIDER") === "demo" ? "demo" : "stripe",
          stripeSecretKey: Deno.env.get("STRIPE_SECRET_KEY") ?? null,
        }),
        channel: "mcp",
      };

      let body: unknown;
      try {
        body = await req.json();
      } catch {
        return Response.json(
          { jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } },
          { status: 400 },
        );
      }

      try {
        const response = await handleMcpRequest(body, { domain, principalLabel: displayName });
        if (response === null) {
          return new Response(null, { status: 204 });
        }
        return Response.json(response);
      } catch (error) {
        log("MCP request failed", { error: error instanceof Error ? error.message : String(error) });
        return Response.json({ error: "internal error" }, { status: 500 });
      }
    },
  ),
);

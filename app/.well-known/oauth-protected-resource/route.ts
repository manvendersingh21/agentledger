import { NextResponse } from "next/server";
import { serverEnv } from "@/lib/env";

function appUrl(): string {
  return process.env.APP_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? "http://127.0.0.1:3000";
}

/** RFC 9728 OAuth protected resource metadata for the MCP endpoint. */
export async function GET() {
  const supabaseUrl = serverEnv.supabaseUrl().replace(/\/$/, "");
  return NextResponse.json({
    resource: `${appUrl().replace(/\/$/, "")}/api/mcp`,
    authorization_servers: [`${supabaseUrl}/auth/v1`],
    bearer_methods_supported: ["header"],
  });
}

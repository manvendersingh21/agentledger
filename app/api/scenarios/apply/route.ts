import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { appendAuditEvent } from "@/lib/domain/audit";
import { getDomainContext } from "@/lib/domain/server-context";
import { errorResponse, unauthorized } from "@/lib/domain/http";

export const runtime = "nodejs";

const ScenarioId = z.enum(["home", "diy", "restaurant", "grocery", "software"]);

const BLOCKED_CATEGORIES = ["crypto", "gift_card", "wire_transfer"] as const;

type ScenarioPreset = {
  scenario: z.infer<typeof ScenarioId>;
  max_amount_cents: number;
  daily_limit_cents: number;
  approval_threshold_cents: number;
  allowed_categories: string[];
  allow_recurring: boolean;
};

const PRESETS: Record<z.infer<typeof ScenarioId>, ScenarioPreset> = {
  home: {
    scenario: "home",
    max_amount_cents: 15_000,
    daily_limit_cents: 30_000,
    approval_threshold_cents: 6_000,
    allowed_categories: ["home_appliance"],
    allow_recurring: false,
  },
  diy: {
    scenario: "diy",
    max_amount_cents: 10_000,
    daily_limit_cents: 20_000,
    approval_threshold_cents: 5_000,
    allowed_categories: ["diy_tools", "diy_supplies"],
    allow_recurring: false,
  },
  restaurant: {
    scenario: "restaurant",
    max_amount_cents: 12_000,
    daily_limit_cents: 60_000,
    approval_threshold_cents: 7_500,
    allowed_categories: ["restaurant_food", "restaurant_supplies"],
    allow_recurring: false,
  },
  grocery: {
    scenario: "grocery",
    max_amount_cents: 8_000,
    daily_limit_cents: 15_000,
    approval_threshold_cents: 4_000,
    allowed_categories: ["grocery"],
    allow_recurring: false,
  },
  software: {
    scenario: "software",
    max_amount_cents: 2_000,
    daily_limit_cents: 5_000,
    approval_threshold_cents: 1_000,
    allowed_categories: [],
    allow_recurring: false,
  },
};

const SOFTWARE_MERCHANTS = ["acme-api", "vectorbase", "devhost"] as const;

async function trustedMerchantsForCategories(db: SupabaseClient, categories: string[]): Promise<string[]> {
  if (categories.length === 0) return [...SOFTWARE_MERCHANTS];
  const { data, error } = await db
    .from("products")
    .select("merchants!inner(slug, trusted)")
    .eq("active", true)
    .in("category", categories);
  if (error) throw new Error(`merchant catalog lookup failed: ${error.message}`);
  const slugs = new Set<string>();
  for (const row of data ?? []) {
    const merchants = row.merchants as { slug: string; trusted: boolean } | { slug: string; trusted: boolean }[];
    const list = Array.isArray(merchants) ? merchants : [merchants];
    for (const m of list) {
      if (m.trusted) slugs.add(m.slug);
    }
  }
  return [...slugs].sort();
}

/** Applies a demo delegation preset for the signed-in principal (service role after auth). */
export async function POST(request: Request) {
  try {
    const session = await getDomainContext("scenarios");
    if (!session) return unauthorized();

    const body = z.object({ scenario: ScenarioId }).parse(await request.json());
    const preset = PRESETS[body.scenario];
    const { ctx } = session;

    const allowed_merchants =
      body.scenario === "software"
        ? [...SOFTWARE_MERCHANTS]
        : await trustedMerchantsForCategories(ctx.db, preset.allowed_categories);

    if (allowed_merchants.length === 0) {
      return NextResponse.json(
        { error: "CATALOG_UNAVAILABLE", message: "No trusted merchants found for this scenario yet." },
        { status: 503 },
      );
    }

    const { data: delegation, error: lookupError } = await ctx.db
      .from("delegations")
      .select("id, agent_id")
      .eq("principal_id", ctx.principalId)
      .eq("agent_id", ctx.agentId)
      .eq("action_type", "purchase")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (lookupError) throw new Error(lookupError.message);
    if (!delegation) {
      return NextResponse.json({ error: "NOT_FOUND", message: "No delegation for this agent." }, { status: 404 });
    }

    const changes = {
      max_amount_cents: preset.max_amount_cents,
      daily_limit_cents: preset.daily_limit_cents,
      approval_threshold_cents: preset.approval_threshold_cents,
      allow_recurring: preset.allow_recurring,
      allowed_merchants,
      denied_merchants: [] as string[],
      status: "active" as const,
      min_trust_score: 95,
      kill_switch_enabled: true,
      blocked_categories: [...BLOCKED_CATEGORIES],
      allowed_categories: preset.allowed_categories,
      market_price_tolerance: 1.5,
      scenario: preset.scenario,
    };

    const { data: updated, error: updateError } = await ctx.db
      .from("delegations")
      .update(changes)
      .eq("id", delegation.id)
      .eq("principal_id", ctx.principalId)
      .select("*")
      .single();

    if (updateError || !updated) throw new Error(updateError?.message ?? "delegation update failed");

    await appendAuditEvent(ctx.db, {
      principalId: ctx.principalId,
      agentId: delegation.agent_id,
      eventType: "DELEGATION_UPDATED",
      eventData: { delegation_id: delegation.id, ...changes, channel: "scenarios" },
    });

    return NextResponse.json({ scenario: body.scenario, delegation: updated });
  } catch (error) {
    return errorResponse(error);
  }
}

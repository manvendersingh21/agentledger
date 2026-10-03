// Restaurant inventory autopilot: deterministic restock via proposePurchase (channel "autopilot").
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import {
  getDelegation,
  proposePurchase,
  type AnyViolation,
  type DomainContext,
  type ProposeResult,
} from "./pipeline";
import { formatUsd, type MerchantRow } from "./products";

export interface InventoryItemRow {
  id: string;
  principal_id: string;
  name: string;
  unit: string;
  on_hand: number;
  par_level: number;
  reorder_point: number;
  preferred_category: string;
  search_query: string;
  reorder_qty: number;
  last_ordered_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface InventoryRestockMeta {
  inventory_item_id: string;
  inventory_unit_add: number;
  inventory_restock: true;
  inventory_receipt_applied?: string;
}

export type RestockOutcome = "auto_bought" | "waiting" | "blocked" | "skipped";

export interface RestockLineResult {
  inventory_item_id: string;
  item_name: string;
  outcome: RestockOutcome;
  message: string;
  intent_id?: string;
  approval_id?: string;
  provider_reference?: string;
  violations?: AnyViolation[];
  skipped_cheaper_untrusted?: { product_name: string; merchant_name: string; price_cents: number };
  product_name?: string;
  amount_cents?: number;
}

interface CatalogProduct {
  id: string;
  name: string;
  description: string;
  price_cents: number;
  category: string;
  attributes: Record<string, unknown>;
  merchants: MerchantRow;
}

const PRODUCT_SELECT =
  "id, name, description, price_cents, category, attributes, active, merchants!inner(id, slug, name, trusted, domain, trust_score, trust_score_source, verified)";

function matchesSearchQuery(product: CatalogProduct, query: string): boolean {
  const hay = `${product.name} ${product.description}`.toLowerCase();
  const terms = query
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length > 0);
  if (terms.length === 0) return true;
  return terms.every((t) => hay.includes(t));
}

function unitAddPerPurchase(product: CatalogProduct, inventoryUnit: string): number {
  const attrs = product.attributes ?? {};
  if (inventoryUnit === "lb" && typeof attrs.weight_lb === "number") return attrs.weight_lb;
  if (inventoryUnit === "gal" && typeof attrs.volume_gal === "number") return attrs.volume_gal;
  if (inventoryUnit === "case") return 1;
  if (typeof attrs.weight_lb === "number") return attrs.weight_lb;
  if (typeof attrs.count === "number" && inventoryUnit === "case") return 1;
  const fromName = product.name.match(/(\d+)\s*lb/i);
  if (fromName && inventoryUnit === "lb") return Number(fromName[1]);
  return 1;
}

function purchaseQuantity(item: InventoryItemRow, unitAdd: number): number {
  const deficit = Math.max(0, Number(item.par_level) - Number(item.on_hand));
  if (deficit <= 0) return Math.max(1, item.reorder_qty);
  const qty = Math.ceil(deficit / unitAdd);
  return Math.max(1, Math.min(50, qty));
}

/** Shrinks quantity so price × quantity fits the per-transaction limit, if at least one unit fits. */
export function fitToTransactionLimit(
  quantity: number,
  priceCents: number,
  maxAmountCents: number | undefined,
): { quantity: number; note?: string } {
  if (maxAmountCents === undefined || priceCents <= 0 || priceCents * quantity <= maxAmountCents) return { quantity };
  const fits = Math.floor(maxAmountCents / priceCents);
  if (fits < 1) return { quantity };
  return {
    quantity: fits,
    note: `Reduced quantity from ${quantity} to ${fits} (${formatUsd(priceCents * fits)}) to fit the ${formatUsd(maxAmountCents)} per-transaction limit; ${quantity} × ${formatUsd(priceCents)} = ${formatUsd(priceCents * quantity)} would exceed it.`,
  };
}

export interface PickProductResult {
  product: CatalogProduct;
  skippedCheaperUntrusted?: { product_name: string; merchant_name: string; price_cents: number };
}

/** Cheapest trusted, delegation-allowed listing in category matching the item search query. */
export async function pickProductForRestock(
  db: SupabaseClient,
  item: InventoryItemRow,
  allowedMerchants: string[],
): Promise<PickProductResult | null> {
  const { data, error } = await db
    .from("products")
    .select(PRODUCT_SELECT)
    .eq("active", true)
    .eq("category", item.preferred_category);
  if (error) throw new Error(`catalog lookup failed: ${error.message}`);
  const rows = (data ?? []) as unknown as CatalogProduct[];
  const matching = rows.filter((p) => matchesSearchQuery(p, item.search_query)).sort((a, b) => a.price_cents - b.price_cents);
  if (matching.length === 0) return null;

  const cheapest = matching[0];
  const trustedAllowed = matching.filter((p) => p.merchants.trusted && allowedMerchants.includes(p.merchants.slug));
  const picked = trustedAllowed[0];
  if (!picked) return null;

  let skippedCheaperUntrusted: PickProductResult["skippedCheaperUntrusted"];
  if (
    cheapest.id !== picked.id &&
    (!cheapest.merchants.trusted || !allowedMerchants.includes(cheapest.merchants.slug))
  ) {
    skippedCheaperUntrusted = {
      product_name: cheapest.name,
      merchant_name: cheapest.merchants.name,
      price_cents: cheapest.price_cents,
    };
  }
  return { product: picked, skippedCheaperUntrusted };
}

async function loadInventoryItems(db: SupabaseClient, principalId: string): Promise<InventoryItemRow[]> {
  const { data, error } = await db
    .from("inventory_items")
    .select("*")
    .eq("principal_id", principalId)
    .order("name");
  if (error) throw new Error(`inventory load failed: ${error.message}`);
  return (data ?? []) as InventoryItemRow[];
}

export async function listInventory(ctx: Pick<DomainContext, "db" | "principalId">): Promise<InventoryItemRow[]> {
  return loadInventoryItems(ctx.db, ctx.principalId);
}

/** Deterministic pseudo-random busy night (mulberry32). */
export function simulateBusyNight(
  ctx: Pick<DomainContext, "db" | "principalId">,
  seed = 6103,
): Promise<InventoryItemRow[]> {
  return simulateBusyNightInternal(ctx, seed);
}

async function simulateBusyNightInternal(
  ctx: Pick<DomainContext, "db" | "principalId">,
  seed: number,
): Promise<InventoryItemRow[]> {
  const items = await loadInventoryItems(ctx.db, ctx.principalId);
  let state = seed >>> 0;
  const rand = () => {
    state += 0x6d2b79f5;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  for (const item of items) {
    const burn = 0.15 + rand() * 0.55;
    const drop = Math.max(1, Math.round(Number(item.on_hand) * burn));
    const next = Math.max(0, Number(item.on_hand) - drop);
    const { error } = await ctx.db
      .from("inventory_items")
      .update({ on_hand: next })
      .eq("id", item.id)
      .eq("principal_id", ctx.principalId);
    if (error) throw new Error(`simulate update failed: ${error.message}`);
  }
  return loadInventoryItems(ctx.db, ctx.principalId);
}

function restockMeta(payload: Record<string, unknown>): InventoryRestockMeta | null {
  const itemId = payload.inventory_item_id;
  const unitAdd = payload.inventory_unit_add;
  if (payload.inventory_restock !== true || typeof itemId !== "string" || typeof unitAdd !== "number") return null;
  return {
    inventory_item_id: itemId,
    inventory_unit_add: unitAdd,
    inventory_restock: true,
    inventory_receipt_applied:
      typeof payload.inventory_receipt_applied === "string" ? payload.inventory_receipt_applied : undefined,
  };
}

/** Increment on_hand for an executed autopilot intent (idempotent). */
export async function applyReceiptToInventory(
  ctx: Pick<DomainContext, "db" | "principalId">,
  intentId: string,
): Promise<{ applied: boolean; inventory_item_id?: string; new_on_hand?: number }> {
  z.string().uuid().parse(intentId);
  const { data: intent, error } = await ctx.db
    .from("action_intents")
    .select("id, status, payload, principal_id")
    .eq("id", intentId)
    .eq("principal_id", ctx.principalId)
    .maybeSingle();
  if (error) throw new Error(`intent load failed: ${error.message}`);
  if (!intent || intent.status !== "executed") return { applied: false };

  const payload = (intent.payload ?? {}) as Record<string, unknown>;
  if (payload.channel !== "autopilot") return { applied: false };
  const meta = restockMeta(payload);
  if (!meta || meta.inventory_receipt_applied) return { applied: false };

  const quantity = typeof payload.quantity === "number" ? payload.quantity : 1;
  const add = meta.inventory_unit_add * quantity;

  // Claim the applied flag FIRST with a conditional update: two concurrent callers (restock
  // route + a reconcile from another request) would otherwise both read the unset flag and
  // double-increment on_hand. Only the caller whose claim lands may increment.
  const appliedAt = new Date().toISOString();
  const { data: claimed, error: claimErr } = await ctx.db
    .from("action_intents")
    .update({ payload: { ...payload, inventory_receipt_applied: appliedAt } })
    .eq("id", intentId)
    .eq("principal_id", ctx.principalId)
    .is("payload->>inventory_receipt_applied", null)
    .select("id");
  if (claimErr) throw new Error(`inventory receipt claim failed: ${claimErr.message}`);
  if (!claimed || claimed.length === 0) return { applied: false };

  const { data: item, error: itemErr } = await ctx.db
    .from("inventory_items")
    .select("on_hand")
    .eq("id", meta.inventory_item_id)
    .eq("principal_id", ctx.principalId)
    .maybeSingle();
  if (itemErr) throw new Error(`inventory item load failed: ${itemErr.message}`);
  if (!item) return { applied: false };

  const newOnHand = Number(item.on_hand) + add;
  const { error: updErr } = await ctx.db
    .from("inventory_items")
    .update({ on_hand: newOnHand })
    .eq("id", meta.inventory_item_id)
    .eq("principal_id", ctx.principalId);
  if (updErr) throw new Error(`inventory increment failed: ${updErr.message}`);

  return { applied: true, inventory_item_id: meta.inventory_item_id, new_on_hand: newOnHand };
}

/** Poll-safe: apply inventory for executed autopilot intents not yet marked applied. */
export async function reconcileAutopilotReceipts(
  ctx: Pick<DomainContext, "db" | "principalId">,
): Promise<{ reconciled: string[] }> {
  const { data, error } = await ctx.db
    .from("action_intents")
    .select("id, status, payload, updated_at")
    .eq("principal_id", ctx.principalId)
    .eq("status", "executed")
    .order("updated_at", { ascending: true });
  if (error) throw new Error(`intent reconcile query failed: ${error.message}`);

  const reconciled: string[] = [];
  for (const row of data ?? []) {
    const payload = (row.payload ?? {}) as Record<string, unknown>;
    if (payload.channel !== "autopilot" || payload.inventory_restock !== true) continue;
    if (typeof payload.inventory_receipt_applied === "string") continue;
    const result = await applyReceiptToInventory(ctx, row.id as string);
    if (result.applied) reconciled.push(row.id as string);
  }
  return { reconciled };
}

async function attachRestockPayload(
  ctx: DomainContext,
  intentId: string,
  meta: InventoryRestockMeta,
): Promise<void> {
  const { data, error } = await ctx.db
    .from("action_intents")
    .select("payload")
    .eq("id", intentId)
    .eq("principal_id", ctx.principalId)
    .maybeSingle();
  if (error) throw new Error(`intent payload read failed: ${error.message}`);
  const existing = ((data?.payload ?? {}) as Record<string, unknown>) ?? {};
  const { error: upd } = await ctx.db
    .from("action_intents")
    .update({
      payload: {
        ...existing,
        channel: "autopilot",
        ...meta,
      },
    })
    .eq("id", intentId)
    .eq("principal_id", ctx.principalId);
  if (upd) throw new Error(`intent payload update failed: ${upd.message}`);
}

function mapProposeToLine(
  item: InventoryItemRow,
  propose: ProposeResult,
  skipped?: PickProductResult["skippedCheaperUntrusted"],
  productName?: string,
): RestockLineResult {
  const base = {
    inventory_item_id: item.id,
    item_name: item.name,
    skipped_cheaper_untrusted: skipped,
    product_name: productName,
  };

  if (propose.status === "denied") {
    const msg = propose.reasons?.join("; ") || propose.message;
    return {
      ...base,
      outcome: "blocked",
      message: msg,
      intent_id: propose.intent_id,
      violations: propose.violations,
      amount_cents: propose.authoritative?.amount_cents,
    };
  }
  if (propose.status === "awaiting_approval") {
    return {
      ...base,
      outcome: "waiting",
      message: propose.message,
      intent_id: propose.intent_id,
      approval_id: propose.approval_id,
      amount_cents: propose.authoritative.amount_cents,
    };
  }
  if (propose.status === "executed") {
    return {
      ...base,
      outcome: "auto_bought",
      message: `Auto-approved and purchased ${propose.authoritative.amount_display}.`,
      intent_id: propose.intent_id,
      provider_reference: propose.provider_reference,
      amount_cents: propose.amount,
    };
  }
  if (propose.status === "duplicate" && propose.already_executed) {
    return {
      ...base,
      outcome: "auto_bought",
      message: "Purchase already executed (duplicate prevented).",
      intent_id: propose.intent_id,
    };
  }
  if (propose.status === "replay") {
    // Routine on a second autopilot run: the deterministic idempotency key matches an intent
    // that is still in flight. Map by the original intent's current status instead of "blocked".
    if (propose.current_status === "executed") {
      return {
        ...base,
        outcome: "auto_bought",
        message: "Already proposed — the identical purchase was executed (replay prevented).",
        intent_id: propose.intent_id,
      };
    }
    if (propose.current_status === "awaiting_approval") {
      return {
        ...base,
        outcome: "waiting",
        message: "Already proposed — the identical purchase is still awaiting human approval.",
        intent_id: propose.intent_id,
      };
    }
    return {
      ...base,
      outcome: "skipped",
      message: `Already proposed (current status: ${propose.current_status}).`,
      intent_id: propose.intent_id,
    };
  }
  return {
    ...base,
    outcome: "blocked",
    message: propose.status === "rejected" ? propose.message : `Restock could not complete (${propose.status}).`,
    intent_id: "intent_id" in propose ? propose.intent_id : undefined,
  };
}

export async function runRestock(ctx: DomainContext): Promise<{ results: RestockLineResult[]; items: InventoryItemRow[] }> {
  const autopilotCtx: DomainContext = { ...ctx, channel: "autopilot" };
  const delegation = await getDelegation(autopilotCtx);
  const allowedMerchants = delegation?.allowedMerchants ?? [];
  const items = await loadInventoryItems(ctx.db, ctx.principalId);
  const results: RestockLineResult[] = [];

  for (const item of items) {
    if (Number(item.on_hand) > Number(item.reorder_point)) {
      results.push({
        inventory_item_id: item.id,
        item_name: item.name,
        outcome: "skipped",
        message: "Stock above reorder point.",
      });
      continue;
    }

    const pick = await pickProductForRestock(ctx.db, item, allowedMerchants);
    if (!pick) {
      results.push({
        inventory_item_id: item.id,
        item_name: item.name,
        outcome: "blocked",
        message: "No trusted, allowed supplier found for this item.",
      });
      continue;
    }

    const unitAdd = unitAddPerPurchase(pick.product, item.unit);
    const fit = fitToTransactionLimit(purchaseQuantity(item, unitAdd), pick.product.price_cents, delegation?.maxAmountCents);
    const quantity = fit.quantity;
    const idempotencyKey = `autopilot-${item.id}-${pick.product.id}-${quantity}`;

    const propose = await proposePurchase(autopilotCtx, {
      product_id: pick.product.id,
      quantity,
      reason: `Autopilot restock: ${item.name} (on hand ${item.on_hand} ${item.unit}, par ${item.par_level})${fit.note ? `. ${fit.note}` : ""}`,
      idempotency_key: idempotencyKey,
    });

    if ("intent_id" in propose && propose.intent_id) {
      await attachRestockPayload(autopilotCtx, propose.intent_id, {
        inventory_item_id: item.id,
        inventory_unit_add: unitAdd,
        inventory_restock: true,
      });
      await ctx.db
        .from("inventory_items")
        .update({ last_ordered_at: new Date().toISOString() })
        .eq("id", item.id)
        .eq("principal_id", ctx.principalId);
    }

    if (propose.status === "executed" && propose.intent_id) {
      await applyReceiptToInventory(autopilotCtx, propose.intent_id);
    }

    let line = mapProposeToLine(item, propose, pick.skippedCheaperUntrusted, pick.product.name);
    if (fit.note) {
      line = { ...line, message: `${fit.note} ${line.message}` };
    }
    if (pick.skippedCheaperUntrusted) {
      const skipNote = `AgentLedger skipped cheaper untrusted supplier (${pick.skippedCheaperUntrusted.merchant_name} — ${pick.skippedCheaperUntrusted.product_name}).`;
      line = { ...line, message: `${skipNote} ${line.message}` };
    }
    results.push(line);
  }

  const refreshed = await loadInventoryItems(ctx.db, ctx.principalId);
  return { results, items: refreshed };
}

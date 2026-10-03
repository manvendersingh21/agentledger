// Grocery autopilot: deterministic due-item planning and policy-gated per-line checkout.
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { getDelegation, proposePurchase, type AnyViolation, type DomainContext, type ProposeResult } from "./pipeline";
import type { MerchantRow } from "./products";

export interface GroceryListRow {
  id: string;
  principal_id: string;
  item_name: string;
  quantity: number;
  unit: string;
  staple: boolean;
  frequency_days: number;
  last_bought_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface GrocerySettingsRow {
  principal_id: string;
  weekly_budget_cents: number;
  created_at: string;
  updated_at: string;
}

interface GroceryProduct {
  id: string;
  name: string;
  description: string;
  price_cents: number;
  market_price_cents: number | null;
  attributes: Record<string, unknown>;
  merchants: MerchantRow;
}

export interface SkippedGroceryOption {
  product_name: string;
  merchant_name: string;
  price_cents: number;
}

export interface GroceryBasketLine {
  grocery_list_id: string;
  item_name: string;
  quantity: number;
  unit: string;
  staple: boolean;
  product_id: string;
  product_name: string;
  merchant_slug: string;
  merchant_name: string;
  unit_price_cents: number;
  line_total_cents: number;
  market_price_cents: number | null;
  savings_cents: number;
  skipped_cheaper_untrusted?: SkippedGroceryOption;
}

export interface GroceryDroppedItem {
  grocery_list_id: string;
  item_name: string;
  staple: boolean;
  reason: string;
}

export interface GroceryPlan {
  basket: GroceryBasketLine[];
  dropped: GroceryDroppedItem[];
  weekly_budget_cents: number;
  weekly_spent_cents: number;
  available_budget_cents: number;
  basket_total_cents: number;
  total_savings_cents: number;
  explanation: string;
}

export type GroceryCheckoutOutcome = "auto_bought" | "waiting" | "blocked";

export interface GroceryCheckoutLineResult {
  grocery_list_id: string;
  item_name: string;
  product_name: string;
  merchant_name: string;
  outcome: GroceryCheckoutOutcome;
  message: string;
  intent_id?: string;
  approval_id?: string;
  provider_reference?: string;
  amount_cents?: number;
  violations?: AnyViolation[];
}

const PRODUCT_SELECT =
  "id, name, description, price_cents, market_price_cents, attributes, merchants!inner(id, slug, name, trusted, domain, trust_score, trust_score_source, verified)";

export const GroceryCheckoutInput = z.object({
  lines: z
    .array(
      z.object({
        grocery_list_id: z.string().uuid(),
        product_id: z.string().uuid(),
        quantity: z.number().int().min(1).max(50),
      }),
    )
    .min(1)
    .max(50),
});
export type GroceryCheckoutInput = z.infer<typeof GroceryCheckoutInput>;

export async function listGroceries(
  ctx: Pick<DomainContext, "db" | "principalId">,
): Promise<{ items: GroceryListRow[]; settings: GrocerySettingsRow }> {
  const [{ data: items, error: itemError }, { data: settings, error: settingsError }] = await Promise.all([
    ctx.db.from("grocery_lists").select("*").eq("principal_id", ctx.principalId).order("created_at"),
    ctx.db.from("grocery_settings").select("*").eq("principal_id", ctx.principalId).maybeSingle(),
  ]);
  if (itemError) throw new Error(`grocery list lookup failed: ${itemError.message}`);
  if (settingsError) throw new Error(`grocery settings lookup failed: ${settingsError.message}`);
  const fallback: GrocerySettingsRow = {
    principal_id: ctx.principalId,
    weekly_budget_cents: 8000,
    created_at: new Date(0).toISOString(),
    updated_at: new Date(0).toISOString(),
  };
  return {
    items: (items ?? []) as GroceryListRow[],
    settings: (settings as GrocerySettingsRow | null) ?? fallback,
  };
}

export function groceryItemIsDue(item: GroceryListRow, now: Date): boolean {
  if (!item.last_bought_at) return true;
  if (!item.staple) return false;
  const boughtAt = new Date(item.last_bought_at).getTime();
  if (!Number.isFinite(boughtAt)) return true;
  return now.getTime() - boughtAt >= item.frequency_days * 86_400_000;
}

function normalized(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function productMatchesItem(product: GroceryProduct, itemName: string): boolean {
  const attributeItem = product.attributes.item;
  if (typeof attributeItem === "string" && normalized(attributeItem) === normalized(itemName)) return true;
  const haystack = normalized(`${product.name} ${product.description}`);
  const terms = normalized(itemName).split(" ").filter(Boolean);
  return terms.length > 0 && terms.every((term) => haystack.includes(term));
}

function merchantIsTrusted(merchant: MerchantRow): boolean {
  const score = merchant.trust_score === null || merchant.trust_score === undefined
    ? null
    : Number(merchant.trust_score);
  return merchant.trusted && (score === null || score >= 95);
}

async function loadGroceryProducts(db: SupabaseClient): Promise<GroceryProduct[]> {
  const { data, error } = await db
    .from("products")
    .select(PRODUCT_SELECT)
    .eq("active", true)
    .eq("category", "grocery")
    .order("price_cents");
  if (error) throw new Error(`grocery catalog lookup failed: ${error.message}`);
  return (data ?? []) as unknown as GroceryProduct[];
}

function startOfUtcWeek(now: Date): string {
  const start = new Date(now);
  const daysSinceMonday = (start.getUTCDay() + 6) % 7;
  start.setUTCHours(0, 0, 0, 0);
  start.setUTCDate(start.getUTCDate() - daysSinceMonday);
  return start.toISOString();
}

async function grocerySpendThisWeek(ctx: Pick<DomainContext, "db" | "principalId" | "now">): Promise<number> {
  const now = (ctx.now ?? (() => new Date()))();
  const { data, error } = await ctx.db
    .from("action_intents")
    .select("amount_cents")
    .eq("principal_id", ctx.principalId)
    .eq("payload->>channel", "grocery")
    .in("status", ["awaiting_approval", "approved", "executing", "executed"])
    .gte("created_at", startOfUtcWeek(now));
  if (error) throw new Error(`weekly grocery spend lookup failed: ${error.message}`);
  return (data ?? []).reduce((sum, row) => sum + Number(row.amount_cents), 0);
}

function compareDuePriority(a: GroceryListRow, b: GroceryListRow): number {
  if (a.staple !== b.staple) return a.staple ? -1 : 1;
  const aBought = a.last_bought_at ? new Date(a.last_bought_at).getTime() : 0;
  const bBought = b.last_bought_at ? new Date(b.last_bought_at).getTime() : 0;
  if (aBought !== bBought) return aBought - bBought;
  return a.created_at.localeCompare(b.created_at) || a.item_name.localeCompare(b.item_name);
}

/** Builds a deterministic basket from due staples and unpurchased user-added items. */
export async function planBasket(ctx: DomainContext): Promise<GroceryPlan> {
  const now = (ctx.now ?? (() => new Date()))();
  await reconcileGroceryPurchases(ctx);
  const [{ items, settings }, delegation, products, weeklySpent] = await Promise.all([
    listGroceries(ctx),
    getDelegation(ctx),
    loadGroceryProducts(ctx.db),
    grocerySpendThisWeek(ctx),
  ]);
  const allowedMerchants = new Set(delegation?.allowedMerchants ?? []);
  const available = Math.max(0, settings.weekly_budget_cents - weeklySpent);
  const due = items.filter((item) => groceryItemIsDue(item, now)).sort(compareDuePriority);
  const basket: GroceryBasketLine[] = [];
  const dropped: GroceryDroppedItem[] = [];
  let remaining = available;

  for (const item of due) {
    const matching = products.filter((product) => productMatchesItem(product, item.item_name));
    const trustedAllowed = matching.filter(
      (product) => merchantIsTrusted(product.merchants) && allowedMerchants.has(product.merchants.slug),
    );
    const product = trustedAllowed[0];
    if (!product) {
      dropped.push({
        grocery_list_id: item.id,
        item_name: item.item_name,
        staple: item.staple,
        reason: "No trusted, delegation-allowed grocery listing matched this item.",
      });
      continue;
    }

    const lineTotal = product.price_cents * item.quantity;
    if (lineTotal > remaining) {
      dropped.push({
        grocery_list_id: item.id,
        item_name: item.item_name,
        staple: item.staple,
        reason: item.staple
          ? "Weekly budget remaining could not cover this due staple."
          : "Dropped as a lower-priority extra to stay within the weekly budget.",
      });
      continue;
    }

    const skipped = matching.find(
      (candidate) => candidate.price_cents < product.price_cents && !merchantIsTrusted(candidate.merchants),
    );
    const market = product.market_price_cents;
    basket.push({
      grocery_list_id: item.id,
      item_name: item.item_name,
      quantity: item.quantity,
      unit: item.unit,
      staple: item.staple,
      product_id: product.id,
      product_name: product.name,
      merchant_slug: product.merchants.slug,
      merchant_name: product.merchants.name,
      unit_price_cents: product.price_cents,
      line_total_cents: lineTotal,
      market_price_cents: market,
      savings_cents: market === null ? 0 : Math.max(0, market - product.price_cents) * item.quantity,
      skipped_cheaper_untrusted: skipped
        ? {
            product_name: skipped.name,
            merchant_name: skipped.merchants.name,
            price_cents: skipped.price_cents,
          }
        : undefined,
    });
    remaining -= lineTotal;
  }

  const basketTotal = basket.reduce((sum, line) => sum + line.line_total_cents, 0);
  const totalSavings = basket.reduce((sum, line) => sum + line.savings_cents, 0);
  const budgetDrops = dropped.filter((item) => /budget|lower-priority/.test(item.reason)).length;
  return {
    basket,
    dropped,
    weekly_budget_cents: settings.weekly_budget_cents,
    weekly_spent_cents: weeklySpent,
    available_budget_cents: available,
    basket_total_cents: basketTotal,
    total_savings_cents: totalSavings,
    explanation:
      budgetDrops > 0
        ? `Kept due staples ahead of extras and left out ${budgetDrops} item${budgetDrops === 1 ? "" : "s"} to stay within the weekly budget.`
        : `Planned ${basket.length} due item${basket.length === 1 ? "" : "s"} within the weekly budget.`,
  };
}

function baseCheckoutResult(
  item: GroceryListRow,
  product: GroceryProduct,
): Pick<GroceryCheckoutLineResult, "grocery_list_id" | "item_name" | "product_name" | "merchant_name"> {
  return {
    grocery_list_id: item.id,
    item_name: item.item_name,
    product_name: product.name,
    merchant_name: product.merchants.name,
  };
}

async function mapCheckoutResult(
  ctx: DomainContext,
  item: GroceryListRow,
  product: GroceryProduct,
  proposed: ProposeResult,
): Promise<GroceryCheckoutLineResult> {
  const base = baseCheckoutResult(item, product);
  if (proposed.status === "executed") {
    return {
      ...base,
      outcome: "auto_bought",
      message: `Auto-approved and purchased ${proposed.authoritative.amount_display}.`,
      intent_id: proposed.intent_id,
      provider_reference: proposed.provider_reference,
      amount_cents: proposed.amount,
    };
  }
  if (proposed.status === "awaiting_approval") {
    return {
      ...base,
      outcome: "waiting",
      message: proposed.message,
      intent_id: proposed.intent_id,
      approval_id: proposed.approval_id,
      amount_cents: proposed.authoritative.amount_cents,
    };
  }
  if (proposed.status === "denied") {
    return {
      ...base,
      outcome: "blocked",
      message: proposed.reasons.join("; ") || proposed.message,
      intent_id: proposed.intent_id,
      amount_cents: proposed.authoritative.amount_cents,
      violations: proposed.violations,
    };
  }
  if (proposed.status === "duplicate" && proposed.already_executed) {
    return {
      ...base,
      outcome: "auto_bought",
      message: "This grocery line was already purchased; duplicate checkout was prevented.",
      intent_id: proposed.intent_id,
    };
  }
  if (proposed.status === "replay" && proposed.current_status === "awaiting_approval") {
    const { data } = await ctx.db
      .from("approvals")
      .select("id")
      .eq("intent_id", proposed.intent_id)
      .eq("status", "pending")
      .maybeSingle();
    return {
      ...base,
      outcome: "waiting",
      message: "This grocery line is already waiting for your approval.",
      intent_id: proposed.intent_id,
      approval_id: typeof data?.id === "string" ? data.id : undefined,
    };
  }
  if (proposed.status === "replay" && proposed.current_status === "executed") {
    return {
      ...base,
      outcome: "auto_bought",
      message: "This grocery line was already purchased; duplicate checkout was prevented.",
      intent_id: proposed.intent_id,
    };
  }
  return {
    ...base,
    outcome: "blocked",
    message: proposed.status === "rejected" ? proposed.message : `Checkout could not complete (${proposed.status}).`,
    intent_id: "intent_id" in proposed ? proposed.intent_id : undefined,
  };
}

async function attachGroceryPayload(
  ctx: DomainContext,
  intentId: string,
  groceryListId: string,
): Promise<Record<string, unknown>> {
  const { data, error } = await ctx.db
    .from("action_intents")
    .select("payload")
    .eq("id", intentId)
    .eq("principal_id", ctx.principalId)
    .maybeSingle();
  if (error) throw new Error(`grocery intent payload read failed: ${error.message}`);
  const payload = (data?.payload ?? {}) as Record<string, unknown>;
  const attached = {
    ...payload,
    channel: "grocery",
    grocery_purchase: true,
    grocery_list_id: groceryListId,
  };
  const { error: updateError } = await ctx.db
    .from("action_intents")
    .update({ payload: attached })
    .eq("id", intentId)
    .eq("principal_id", ctx.principalId);
  if (updateError) throw new Error(`grocery intent payload update failed: ${updateError.message}`);
  return attached;
}

/** Applies later-approved grocery receipts to the list once, using intent payload metadata. */
export async function reconcileGroceryPurchases(
  ctx: Pick<DomainContext, "db" | "principalId">,
): Promise<{ reconciled: string[] }> {
  const { data, error } = await ctx.db
    .from("action_intents")
    .select("id, payload, updated_at")
    .eq("principal_id", ctx.principalId)
    .eq("status", "executed")
    .eq("payload->>channel", "grocery")
    .order("updated_at", { ascending: true });
  if (error) throw new Error(`grocery receipt reconciliation failed: ${error.message}`);

  const reconciled: string[] = [];
  for (const row of data ?? []) {
    const payload = (row.payload ?? {}) as Record<string, unknown>;
    const listId = payload.grocery_list_id;
    if (
      payload.grocery_purchase !== true ||
      typeof listId !== "string" ||
      typeof payload.grocery_purchase_applied_at === "string"
    ) {
      continue;
    }
    const purchasedAt = typeof row.updated_at === "string" ? row.updated_at : new Date().toISOString();
    const { error: listError } = await ctx.db
      .from("grocery_lists")
      .update({ last_bought_at: purchasedAt })
      .eq("id", listId)
      .eq("principal_id", ctx.principalId);
    if (listError) throw new Error(`grocery receipt list update failed: ${listError.message}`);

    const { error: intentError } = await ctx.db
      .from("action_intents")
      .update({ payload: { ...payload, grocery_purchase_applied_at: purchasedAt } })
      .eq("id", row.id)
      .eq("principal_id", ctx.principalId);
    if (intentError) throw new Error(`grocery receipt marker update failed: ${intentError.message}`);
    reconciled.push(row.id as string);
  }
  return { reconciled };
}

/** Proposes every basket line independently so the policy can auto-buy, request approval, or block each one. */
export async function checkout(
  ctx: DomainContext,
  rawInput: unknown,
): Promise<{ results: GroceryCheckoutLineResult[] }> {
  const input = GroceryCheckoutInput.parse(rawInput);
  const ids = [...new Set(input.lines.map((line) => line.grocery_list_id))];
  const productIds = [...new Set(input.lines.map((line) => line.product_id))];
  const [{ data: itemData, error: itemError }, { data: productData, error: productError }] = await Promise.all([
    ctx.db.from("grocery_lists").select("*").eq("principal_id", ctx.principalId).in("id", ids),
    ctx.db.from("products").select(PRODUCT_SELECT).eq("category", "grocery").eq("active", true).in("id", productIds),
  ]);
  if (itemError) throw new Error(`grocery checkout list lookup failed: ${itemError.message}`);
  if (productError) throw new Error(`grocery checkout product lookup failed: ${productError.message}`);
  const items = new Map(((itemData ?? []) as GroceryListRow[]).map((item) => [item.id, item]));
  const products = new Map(
    ((productData ?? []) as unknown as GroceryProduct[]).map((product) => [product.id, product]),
  );
  const groceryCtx: DomainContext = { ...ctx, channel: "grocery" };
  const results: GroceryCheckoutLineResult[] = [];
  const checkoutDay = (ctx.now ?? (() => new Date()))().toISOString().slice(0, 10);

  for (const line of input.lines) {
    const item = items.get(line.grocery_list_id);
    const product = products.get(line.product_id);
    if (!item || !product) {
      results.push({
        grocery_list_id: line.grocery_list_id,
        item_name: item?.item_name ?? "Unknown grocery item",
        product_name: product?.name ?? "Unknown product",
        merchant_name: product?.merchants.name ?? "Unknown merchant",
        outcome: "blocked",
        message: "The grocery list item or product is no longer available.",
      });
      continue;
    }
    if (!productMatchesItem(product, item.item_name) || line.quantity !== item.quantity) {
      results.push({
        ...baseCheckoutResult(item, product),
        outcome: "blocked",
        message: "The basket line no longer matches the grocery list. Plan the basket again before checkout.",
      });
      continue;
    }

    const proposed = await proposePurchase(groceryCtx, {
      product_id: product.id,
      quantity: line.quantity,
      reason: `Grocery autopilot: ${item.item_name} (${line.quantity} ${item.unit})`,
      idempotency_key: `grocery-${checkoutDay}-${item.id}-${product.id}-${line.quantity}`,
    });
    const attachedPayload =
      "intent_id" in proposed && proposed.intent_id
        ? await attachGroceryPayload(groceryCtx, proposed.intent_id, item.id)
        : null;
    const result = await mapCheckoutResult(groceryCtx, item, product, proposed);
    results.push(result);

    if (result.outcome === "auto_bought") {
      const purchasedAt = (ctx.now ?? (() => new Date()))().toISOString();
      const { error } = await ctx.db
        .from("grocery_lists")
        .update({ last_bought_at: purchasedAt })
        .eq("id", item.id)
        .eq("principal_id", ctx.principalId);
      if (error) throw new Error(`grocery purchase timestamp update failed: ${error.message}`);
      if (attachedPayload && result.intent_id) {
        const { error: markerError } = await ctx.db
          .from("action_intents")
          .update({ payload: { ...attachedPayload, grocery_purchase_applied_at: purchasedAt } })
          .eq("id", result.intent_id)
          .eq("principal_id", ctx.principalId);
        if (markerError) throw new Error(`grocery purchase marker update failed: ${markerError.message}`);
      }
    }
  }

  return { results };
}

"use client";

import { Check, ShoppingCart } from "lucide-react";
import type { RecipePlan } from "@/lib/domain/recipes";
import { ArrowButton } from "@/components/brand/arrow-button";
import { cn, formatCents } from "@/lib/utils";

/** Catalog product matched to a missing ingredient (authoritative price from tools). */
export interface RecipeChecklistMatch {
  product_name: string;
  price_cents: number;
  merchant_name?: string;
}

export interface RecipeChecklistProps {
  plan: RecipePlan;
  /** Matched catalog products keyed by ingredient name (missing ingredients only). */
  matches?: Record<string, RecipeChecklistMatch>;
  /** Called when the user clicks "Buy missing ingredients". */
  onBuyMissing?: () => void;
  /** Disables the buy button while a checkout is running. */
  buying?: boolean;
  className?: string;
}

function formatQty(qty: number, unit: string): string {
  return `${qty % 1 === 0 ? qty.toFixed(0) : qty} ${unit}`;
}

/** Renders a planRecipe result: ingredients you have vs ingredients to buy, with prices when matched. */
export function RecipeChecklist({ plan, matches = {}, onBuyMissing, buying = false, className }: RecipeChecklistProps) {
  const totalCents = plan.missing.reduce((sum, ingredient) => {
    const match = matches[ingredient.name];
    return match ? sum + match.price_cents : sum;
  }, 0);
  const unmatchedCount = plan.missing.filter((ingredient) => !matches[ingredient.name]).length;

  return (
    <div className={cn("rounded-[6px] border border-line bg-surface p-4 shadow-[0_1px_0_rgba(0,0,0,0.02)] sm:p-5", className)}>
      <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-accent">Recipe plan</p>
      <p className="mt-1 font-medium capitalize text-ink">
        {plan.dish} <span className="font-normal text-ink-2">· {plan.servings} servings</span>
      </p>

      <ul className="mt-4 space-y-2">
        {plan.ingredients.map((ingredient) => {
          const match = !ingredient.have ? matches[ingredient.name] : undefined;
          return (
            <li key={ingredient.name} className="flex items-baseline justify-between gap-3 text-sm">
              <span className="flex min-w-0 items-baseline gap-2">
                {ingredient.have ? (
                  <Check className="size-3.5 shrink-0 translate-y-0.5 text-executed" aria-hidden />
                ) : (
                  <span className="size-3.5 shrink-0 translate-y-0.5 rounded-sm border border-line" aria-hidden />
                )}
                <span className={cn("text-ink", ingredient.have && "text-executed line-through")}>
                  {ingredient.name}
                </span>
                <span className="shrink-0 font-mono text-xs text-ink-3">{formatQty(ingredient.qty, ingredient.unit)}</span>
              </span>
              {ingredient.have ? (
                <span className="shrink-0 text-xs text-executed">have</span>
              ) : match ? (
                <span className="shrink-0 text-right">
                  <span className="font-mono text-ink">{formatCents(match.price_cents)}</span>
                  <span className="ml-2 hidden text-xs text-ink-3 sm:inline">{match.product_name}</span>
                </span>
              ) : (
                <span className="shrink-0 text-xs text-ink-3">to buy</span>
              )}
            </li>
          );
        })}
      </ul>

      {plan.missing.length > 0 ? (
        <div className="mt-5 flex flex-col gap-3 border-t border-line pt-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-ink-2">
            {plan.missing.length} ingredient{plan.missing.length === 1 ? "" : "s"} to buy
            {totalCents > 0 ? (
              <span className="ml-2 font-mono text-ink">{formatCents(totalCents)}</span>
            ) : null}
            {unmatchedCount > 0 && totalCents > 0 ? (
              <span className="ml-1 text-xs text-ink-3">(+{unmatchedCount} unpriced)</span>
            ) : null}
          </p>
          {onBuyMissing ? (
            <ArrowButton
              size="md"
              disabled={buying}
              onClick={onBuyMissing}
              icon={<ShoppingCart className="size-4" strokeWidth={2} />}
            >
              {buying ? "Buying…" : "Buy missing ingredients"}
            </ArrowButton>
          ) : null}
        </div>
      ) : (
        <p className="mt-5 border-t border-line pt-4 text-sm text-executed">
          You already have everything for this recipe.
        </p>
      )}
    </div>
  );
}

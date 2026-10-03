import { describe, expect, it } from "vitest";
import { findRecipe, planRecipe, RECIPES } from "../../lib/domain/recipes.ts";

describe("planRecipe", () => {
  it("returns the full ingredient list at base servings with nothing on hand", () => {
    const plan = planRecipe({ dish: "pancakes", servings: 4, have: [] });
    expect(plan).not.toBeNull();
    expect(plan?.dish).toBe("pancakes");
    expect(plan?.servings).toBe(4);
    const flour = plan?.ingredients.find((i) => i.name === "all-purpose flour");
    expect(flour).toMatchObject({ qty: 2, unit: "cups", have: false, search_query: "all purpose flour" });
    expect(plan?.missing).toHaveLength(plan?.ingredients.length ?? -1);
  });

  it("scales quantities linearly by servings", () => {
    const doubled = planRecipe({ dish: "pancakes", servings: 8, have: [] });
    const flour = doubled?.ingredients.find((i) => i.name === "all-purpose flour");
    const eggs = doubled?.ingredients.find((i) => i.name === "eggs");
    expect(flour?.qty).toBe(4); // 2 cups × (8/4)
    expect(eggs?.qty).toBe(4); // 2 eggs × (8/4)

    const half = planRecipe({ dish: "lasagna", servings: 3, have: [] });
    const beef = half?.ingredients.find((i) => i.name === "ground beef");
    expect(beef?.qty).toBe(0.75); // 1.5 lb × (3/6)
  });

  it("marks 'have' ingredients via case-insensitive substring matching and excludes them from missing", () => {
    const plan = planRecipe({ dish: "pancakes", servings: 4, have: ["EGGS", "flour", "Butter"] });
    expect(plan).not.toBeNull();
    const byName = new Map(plan?.ingredients.map((i) => [i.name, i.have]));
    expect(byName.get("eggs")).toBe(true);
    expect(byName.get("all-purpose flour")).toBe(true); // "flour" is a substring
    expect(byName.get("butter")).toBe(true);
    expect(byName.get("milk")).toBe(false);
    const missingNames = plan?.missing.map((i) => i.name);
    expect(missingNames).not.toContain("eggs");
    expect(missingNames).not.toContain("all-purpose flour");
    expect(missingNames).toContain("milk");
  });

  it("matches when the user's entry contains the ingredient name", () => {
    const plan = planRecipe({ dish: "tomato soup", servings: 4, have: ["a big yellow onion", "minced garlic"] });
    const byName = new Map(plan?.ingredients.map((i) => [i.name, i.have]));
    expect(byName.get("onion")).toBe(true);
    expect(byName.get("garlic")).toBe(true);
    expect(byName.get("butter")).toBe(false);
  });

  it("fuzzy-matches dish names and aliases case-insensitively", () => {
    expect(planRecipe({ dish: "LASAGNA", servings: 6, have: [] })?.dish).toBe("lasagna");
    expect(planRecipe({ dish: "lasagne", servings: 6, have: [] })?.dish).toBe("lasagna");
    expect(planRecipe({ dish: "spag bol", servings: 4, have: [] })?.dish).toBe("spaghetti bolognese");
    expect(planRecipe({ dish: "I want to make banana bread tonight", servings: 8, have: [] })?.dish).toBe("banana bread");
    expect(planRecipe({ dish: "omelet", servings: 2, have: [] })?.dish).toBe("omelette");
  });

  it("returns null for an unknown dish", () => {
    expect(planRecipe({ dish: "beef wellington", servings: 4, have: [] })).toBeNull();
    expect(planRecipe({ dish: "", servings: 4, have: [] })).toBeNull();
    expect(findRecipe("xyz")).toBeNull();
  });

  it("clamps servings to at least 1 and rounds fractional input", () => {
    const plan = planRecipe({ dish: "omelette", servings: 0, have: [] });
    expect(plan?.servings).toBe(1);
    const eggs = plan?.ingredients.find((i) => i.name === "eggs");
    expect(eggs?.qty).toBe(2); // 4 eggs × (1/2)
  });

  it("every recipe ingredient carries a non-empty grocery search_query", () => {
    for (const recipe of RECIPES) {
      for (const ingredient of recipe.ingredients) {
        expect(ingredient.search_query.trim().length, `${recipe.dish} / ${ingredient.name}`).toBeGreaterThan(0);
      }
    }
  });
});

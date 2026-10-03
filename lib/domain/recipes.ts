// Deterministic recipe knowledge: no model involvement — fixed ingredient lists,
// linear scaling by servings, and case-insensitive substring "have" matching.

export interface RecipeIngredient {
  name: string;
  /** Quantity for the recipe's base servings. */
  qty: number;
  unit: string;
  /** Grocery catalog search terms for this ingredient. */
  search_query: string;
}

export interface Recipe {
  dish: string;
  /** Alternative names the user might type (normalized matching). */
  aliases: string[];
  baseServings: number;
  ingredients: RecipeIngredient[];
}

export interface PlannedIngredient {
  name: string;
  qty: number;
  unit: string;
  have: boolean;
  search_query: string;
}

export interface RecipePlan {
  dish: string;
  servings: number;
  ingredients: PlannedIngredient[];
  missing: PlannedIngredient[];
}

export const RECIPES: readonly Recipe[] = [
  {
    dish: "lasagna",
    aliases: ["lasagne"],
    baseServings: 6,
    ingredients: [
      { name: "lasagna noodles", qty: 12, unit: "sheets", search_query: "lasagna pasta sheets" },
      { name: "ground beef", qty: 1.5, unit: "lb", search_query: "ground beef" },
      { name: "tomato sauce", qty: 24, unit: "oz", search_query: "tomato pasta sauce" },
      { name: "ricotta cheese", qty: 15, unit: "oz", search_query: "ricotta cheese" },
      { name: "mozzarella cheese", qty: 12, unit: "oz", search_query: "shredded mozzarella cheese" },
      { name: "parmesan cheese", qty: 4, unit: "oz", search_query: "grated parmesan cheese" },
      { name: "onion", qty: 1, unit: "whole", search_query: "yellow onion" },
      { name: "garlic", qty: 3, unit: "cloves", search_query: "fresh garlic" },
      { name: "olive oil", qty: 2, unit: "tbsp", search_query: "olive oil" },
    ],
  },
  {
    dish: "chicken curry",
    aliases: ["curry"],
    baseServings: 4,
    ingredients: [
      { name: "chicken thighs", qty: 1.5, unit: "lb", search_query: "boneless chicken thighs" },
      { name: "onion", qty: 1, unit: "whole", search_query: "yellow onion" },
      { name: "garlic", qty: 3, unit: "cloves", search_query: "fresh garlic" },
      { name: "ginger", qty: 1, unit: "inch", search_query: "fresh ginger" },
      { name: "curry powder", qty: 2, unit: "tbsp", search_query: "curry powder" },
      { name: "coconut milk", qty: 14, unit: "oz", search_query: "coconut milk can" },
      { name: "basmati rice", qty: 2, unit: "cups", search_query: "basmati rice" },
      { name: "vegetable oil", qty: 2, unit: "tbsp", search_query: "vegetable oil" },
    ],
  },
  {
    dish: "pancakes",
    aliases: ["pancake"],
    baseServings: 4,
    ingredients: [
      { name: "all-purpose flour", qty: 2, unit: "cups", search_query: "all purpose flour" },
      { name: "milk", qty: 1.5, unit: "cups", search_query: "whole milk" },
      { name: "eggs", qty: 2, unit: "whole", search_query: "eggs dozen" },
      { name: "butter", qty: 3, unit: "tbsp", search_query: "unsalted butter" },
      { name: "baking powder", qty: 2, unit: "tsp", search_query: "baking powder" },
      { name: "sugar", qty: 2, unit: "tbsp", search_query: "granulated sugar" },
      { name: "maple syrup", qty: 0.5, unit: "cups", search_query: "maple syrup" },
    ],
  },
  {
    dish: "spaghetti bolognese",
    aliases: ["bolognese", "spag bol", "spaghetti"],
    baseServings: 4,
    ingredients: [
      { name: "spaghetti", qty: 1, unit: "lb", search_query: "spaghetti pasta" },
      { name: "ground beef", qty: 1, unit: "lb", search_query: "ground beef" },
      { name: "tomato sauce", qty: 24, unit: "oz", search_query: "tomato pasta sauce" },
      { name: "onion", qty: 1, unit: "whole", search_query: "yellow onion" },
      { name: "garlic", qty: 3, unit: "cloves", search_query: "fresh garlic" },
      { name: "carrot", qty: 1, unit: "whole", search_query: "carrots" },
      { name: "olive oil", qty: 2, unit: "tbsp", search_query: "olive oil" },
      { name: "parmesan cheese", qty: 2, unit: "oz", search_query: "grated parmesan cheese" },
    ],
  },
  {
    dish: "caesar salad",
    aliases: ["caesar"],
    baseServings: 4,
    ingredients: [
      { name: "romaine lettuce", qty: 2, unit: "heads", search_query: "romaine lettuce" },
      { name: "parmesan cheese", qty: 3, unit: "oz", search_query: "grated parmesan cheese" },
      { name: "croutons", qty: 2, unit: "cups", search_query: "croutons" },
      { name: "caesar dressing", qty: 0.75, unit: "cups", search_query: "caesar dressing" },
      { name: "chicken breast", qty: 1, unit: "lb", search_query: "chicken breast" },
      { name: "lemon", qty: 1, unit: "whole", search_query: "fresh lemon" },
    ],
  },
  {
    dish: "tacos",
    aliases: ["taco"],
    baseServings: 4,
    ingredients: [
      { name: "tortillas", qty: 12, unit: "count", search_query: "corn tortillas" },
      { name: "ground beef", qty: 1, unit: "lb", search_query: "ground beef" },
      { name: "taco seasoning", qty: 1, unit: "packet", search_query: "taco seasoning" },
      { name: "cheddar cheese", qty: 8, unit: "oz", search_query: "shredded cheddar cheese" },
      { name: "lettuce", qty: 1, unit: "head", search_query: "iceberg lettuce" },
      { name: "tomatoes", qty: 2, unit: "whole", search_query: "fresh tomatoes" },
      { name: "salsa", qty: 1, unit: "cup", search_query: "salsa jar" },
      { name: "sour cream", qty: 0.5, unit: "cup", search_query: "sour cream" },
    ],
  },
  {
    dish: "fried rice",
    aliases: [],
    baseServings: 4,
    ingredients: [
      { name: "jasmine rice", qty: 2, unit: "cups", search_query: "jasmine rice" },
      { name: "eggs", qty: 3, unit: "whole", search_query: "eggs dozen" },
      { name: "frozen peas and carrots", qty: 1, unit: "cup", search_query: "frozen peas carrots" },
      { name: "soy sauce", qty: 3, unit: "tbsp", search_query: "soy sauce" },
      { name: "green onions", qty: 3, unit: "stalks", search_query: "green onions scallions" },
      { name: "garlic", qty: 2, unit: "cloves", search_query: "fresh garlic" },
      { name: "sesame oil", qty: 1, unit: "tbsp", search_query: "sesame oil" },
      { name: "vegetable oil", qty: 2, unit: "tbsp", search_query: "vegetable oil" },
    ],
  },
  {
    dish: "omelette",
    aliases: ["omelet"],
    baseServings: 2,
    ingredients: [
      { name: "eggs", qty: 4, unit: "whole", search_query: "eggs dozen" },
      { name: "butter", qty: 1, unit: "tbsp", search_query: "unsalted butter" },
      { name: "cheddar cheese", qty: 2, unit: "oz", search_query: "shredded cheddar cheese" },
      { name: "milk", qty: 2, unit: "tbsp", search_query: "whole milk" },
      { name: "chives", qty: 1, unit: "tbsp", search_query: "fresh chives" },
    ],
  },
  {
    dish: "banana bread",
    aliases: [],
    baseServings: 8,
    ingredients: [
      { name: "bananas", qty: 3, unit: "whole", search_query: "ripe bananas" },
      { name: "all-purpose flour", qty: 2, unit: "cups", search_query: "all purpose flour" },
      { name: "sugar", qty: 0.75, unit: "cups", search_query: "granulated sugar" },
      { name: "butter", qty: 0.5, unit: "cups", search_query: "unsalted butter" },
      { name: "eggs", qty: 2, unit: "whole", search_query: "eggs dozen" },
      { name: "baking soda", qty: 1, unit: "tsp", search_query: "baking soda" },
      { name: "vanilla extract", qty: 1, unit: "tsp", search_query: "vanilla extract" },
    ],
  },
  {
    dish: "tomato soup",
    aliases: [],
    baseServings: 4,
    ingredients: [
      { name: "canned tomatoes", qty: 28, unit: "oz", search_query: "canned whole tomatoes" },
      { name: "onion", qty: 1, unit: "whole", search_query: "yellow onion" },
      { name: "garlic", qty: 2, unit: "cloves", search_query: "fresh garlic" },
      { name: "vegetable broth", qty: 2, unit: "cups", search_query: "vegetable broth" },
      { name: "heavy cream", qty: 0.5, unit: "cups", search_query: "heavy cream" },
      { name: "butter", qty: 2, unit: "tbsp", search_query: "unsalted butter" },
      { name: "basil", qty: 0.25, unit: "cups", search_query: "fresh basil" },
    ],
  },
];

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function namesMatch(a: string, b: string): boolean {
  if (a.length === 0 || b.length === 0) return false;
  if (a === b) return true;
  // Containment with a minimum length on the contained string so e.g. "a" never matches.
  if (a.length >= 3 && b.includes(a)) return true;
  if (b.length >= 3 && a.includes(b)) return true;
  return false;
}

/** Fuzzy dish lookup over dish names and aliases; null when nothing matches. */
export function findRecipe(dish: string): Recipe | null {
  const query = normalize(dish);
  if (query.length === 0) return null;
  for (const recipe of RECIPES) {
    const candidates = [recipe.dish, ...recipe.aliases].map(normalize);
    if (candidates.some((candidate) => namesMatch(query, candidate))) return recipe;
  }
  return null;
}

function roundQty(value: number): number {
  return Math.round(value * 100) / 100;
}

function userHasIngredient(ingredientName: string, have: string[]): boolean {
  const name = normalize(ingredientName);
  return have.some((entry) => namesMatch(normalize(entry), name));
}

/**
 * Deterministic recipe-to-shopping-list: fuzzy dish match, linear scaling by servings,
 * case-insensitive substring matching against what the user already has.
 * Unknown dish → null (the agent should then ask the user to list ingredients).
 */
export function planRecipe(input: { dish: string; servings: number; have: string[] }): RecipePlan | null {
  const recipe = findRecipe(input.dish);
  if (!recipe) return null;
  const servings = Math.max(1, Math.round(input.servings));
  const scale = servings / recipe.baseServings;
  const ingredients: PlannedIngredient[] = recipe.ingredients.map((ingredient) => ({
    name: ingredient.name,
    qty: roundQty(ingredient.qty * scale),
    unit: ingredient.unit,
    have: userHasIngredient(ingredient.name, input.have),
    search_query: ingredient.search_query,
  }));
  return {
    dish: recipe.dish,
    servings,
    ingredients,
    missing: ingredients.filter((ingredient) => !ingredient.have),
  };
}

// Product categories (products.category is free text; these are the values the app understands).
//
// Runtime-agnostic (Next.js server + Supabase Edge/Deno MCP): no imports.

export const PRODUCT_CATEGORIES = [
  "software",
  "home_appliance",
  "diy_tools",
  "diy_supplies",
  "grocery",
  "restaurant_food",
  "restaurant_supplies",
  "crypto",
  "gift_card",
  "wire_transfer",
  "general",
] as const;

export type ProductCategoryName = (typeof PRODUCT_CATEGORIES)[number];

/** Categories blocked by default on delegations; keyword hits here override an agent-supplied category. */
const BLOCKED_KEYWORDS: ReadonlyArray<[ProductCategoryName, readonly string[]]> = [
  ["gift_card", ["gift card", "giftcard", "gift certificate", "prepaid card", "voucher"]],
  ["crypto", ["bitcoin", "btc", "ethereum", "crypto", "cryptocurrency", "usdt", "usdc", "stablecoin"]],
  ["wire_transfer", ["wire transfer", "money transfer", "western union", "moneygram"]],
];

// Order matters: earlier entries win ("drill bit" is a tool, "food processor" an appliance).
const INFERENCE_KEYWORDS: ReadonlyArray<[ProductCategoryName, readonly string[]]> = [
  [
    "diy_tools",
    ["drill", "drill bit", "impact driver", "screwdriver", "hammer", "saw", "wrench", "sander", "pliers", "toolkit", "tool kit", "tool set", "stud finder", "multimeter"],
  ],
  [
    "diy_supplies",
    ["screw", "nail", "bolt", "wall anchor", "paint", "primer", "paint roller", "paintbrush", "sandpaper", "caulk", "spackle", "drywall", "wood glue", "duct tape", "painter tape"],
  ],
  [
    "home_appliance",
    ["fan", "heater", "air purifier", "humidifier", "dehumidifier", "air conditioner", "ac unit", "toaster", "blender", "kettle", "microwave", "coffee maker", "rice cooker", "food processor", "vacuum", "dishwasher", "refrigerator", "fridge"],
  ],
  [
    "grocery",
    ["grocery", "groceries", "food", "milk", "egg", "bread", "banana", "berries", "fruit", "vegetable", "produce", "chicken", "beef", "pork", "fish", "salmon", "meat", "yogurt", "cheese", "butter", "spinach", "lettuce", "tomato", "onion", "garlic", "potato", "carrot", "avocado", "rice", "pasta", "flour", "sugar", "cereal", "coffee", "tea", "juice", "snack", "cookie"],
  ],
];

function keywordPattern(keywords: readonly string[]): RegExp {
  const alternatives = keywords.map((k) => k.replace(/ /g, "\\s+")).join("|");
  return new RegExp(`\\b(?:${alternatives})(?:s|es)?\\b`);
}

const BLOCKED_PATTERNS = BLOCKED_KEYWORDS.map(([category, words]) => [category, keywordPattern(words)] as const);
const INFERENCE_PATTERNS = INFERENCE_KEYWORDS.map(([category, words]) => [category, keywordPattern(words)] as const);

function firstMatch(
  patterns: ReadonlyArray<readonly [ProductCategoryName, RegExp]>,
  text: string,
): ProductCategoryName | null {
  for (const [category, pattern] of patterns) {
    if (pattern.test(text)) return category;
  }
  return null;
}

/**
 * Deterministic category for an external item. An agent-supplied category is honored unless the
 * item name matches a blocked category (the agent is untrusted and must not relabel a gift card).
 * Without a supplied category: keyword inference, else "general". Never defaults to "software".
 */
export function resolveExternalCategory(itemName: string, supplied?: ProductCategoryName): ProductCategoryName {
  const text = itemName.toLowerCase().replace(/[^a-z0-9]+/g, " ");
  const blocked = firstMatch(BLOCKED_PATTERNS, text);
  if (blocked) return blocked;
  if (supplied) return supplied;
  return firstMatch(INFERENCE_PATTERNS, text) ?? "general";
}

// Normalized real-life purchase playbooks for the concierge.
// Pure data + prompt building — importable from both server (concierge) and client (playbook-picker).

export interface PlaybookQuestion {
  /** The clarifying question to ask via ask_user. */
  question: string;
  /** Suggested quick-reply options (rendered as chips). */
  options: string[];
}

export interface Playbook {
  id: string;
  title: string;
  emoji: string;
  /** Example user message that should trigger this playbook (also used as a starter tile). */
  examplePrompt: string;
  /** Product categories this playbook searches (empty = any non-blocked category). */
  category: string[];
  /** At most 3 clarifying questions, each with suggested quick-reply options. */
  clarifyingQuestions: PlaybookQuestion[];
  /** System-prompt text: how to pick the best product from attributes, price, and trust. */
  selectionRules: string;
  /** What the user should expect about approvals for this playbook. */
  approvalNote: string;
}

export const PLAYBOOKS: readonly Playbook[] = [
  {
    id: "home_appliance",
    title: "Home appliance",
    emoji: "🌀",
    examplePrompt: "I need a fan for my bedroom",
    category: ["home_appliance"],
    clarifyingQuestions: [
      {
        question: "How big is the room you want to cool or heat?",
        options: ["Small (under 150 sq ft)", "Medium (150–300 sq ft)", "Large (300–450 sq ft)", "Very large (450+ sq ft)"],
      },
      {
        question: "What's your budget?",
        options: ["Under $40", "$40–$80", "$80–$150", "No strict budget"],
      },
      {
        question: "Does noise matter — e.g. for a bedroom or office?",
        options: ["Must be quiet (bedroom)", "Moderate noise is fine", "Noise doesn't matter"],
      },
    ],
    selectionRules:
      "Match attributes.room_sq_ft_max to the stated room size (never undersize). If quiet matters, prefer lower attributes.noise_db. Within attribute fit, prefer the lowest price from a trusted merchant whose price is at or below market_price_cents; mention attributes.has_remote and energy_w as tiebreakers.",
    approvalNote: "Purchases above the delegation's approval threshold wait for human approval in the dashboard.",
  },
  {
    id: "diy",
    title: "DIY project",
    emoji: "🔨",
    examplePrompt: "I'm building shelves this weekend — get me what I need",
    category: ["diy_tools", "diy_supplies"],
    clarifyingQuestions: [
      {
        question: "What project are you working on?",
        options: ["Building shelves", "Painting a room", "Hanging things on walls", "General repairs"],
      },
      {
        question: "Which tools do you already own?",
        options: ["I have a drill", "I have basic hand tools", "Starting from nothing"],
      },
      {
        question: "What's your total budget for tools and supplies?",
        options: ["Under $50", "$50–$100", "$100–$200"],
      },
    ],
    selectionRules:
      "Split the need into tools (diy_tools) the user is missing and consumables (diy_supplies). Skip tools the user already owns. Prefer trusted merchants at or below market price; propose supplies first if the budget cannot cover everything.",
    approvalNote: "Each item is proposed separately; items above the approval threshold wait for human approval.",
  },
  {
    id: "grocery_weekly",
    title: "Weekly groceries",
    emoji: "🛒",
    examplePrompt: "Stock my kitchen for the week",
    category: ["grocery"],
    clarifyingQuestions: [
      {
        question: "How many people are you shopping for?",
        options: ["Just me", "2 people", "Family of 4", "5 or more"],
      },
      {
        question: "Any dietary preferences or restrictions?",
        options: ["None", "Vegetarian", "Vegan", "Gluten-free"],
      },
      {
        question: "What's your weekly grocery budget?",
        options: ["Under $50", "$50–$100", "$100–$150"],
      },
    ],
    selectionRules:
      "Cover staples first (produce, protein, dairy, pantry), scaled to household size and filtered by diet. Pick the cheapest trusted listing per item; never exceed the stated budget — drop extras, not staples.",
    approvalNote: "Routine grocery lines under the threshold auto-execute; larger baskets wait for human approval.",
  },
  {
    id: "recipe",
    title: "Cook a recipe",
    emoji: "🍳",
    examplePrompt: "I want to make lasagna for 6 on Saturday",
    category: ["grocery"],
    clarifyingQuestions: [
      {
        question: "What dish do you want to make?",
        options: ["Lasagna", "Chicken curry", "Tacos", "Something else"],
      },
      {
        question: "How many servings?",
        options: ["2", "4", "6", "8"],
      },
      {
        question: "Which ingredients do you already have at home?",
        options: ["Just pantry basics (oil, salt, flour)", "I'll list them", "Nothing — buy everything"],
      },
    ],
    selectionRules:
      "Use plan_recipe to get a deterministic ingredient list scaled to servings; if the dish is unknown, ask the user to list ingredients instead of guessing. Only buy the missing ingredients, using each ingredient's search_query; pick the cheapest trusted listing per ingredient.",
    approvalNote: "Missing ingredients are proposed as individual purchases; the total may trigger human approval.",
  },
  {
    id: "restaurant_restock",
    title: "Restaurant restock",
    emoji: "🍽️",
    examplePrompt: "We're low on frying oil and to-go boxes",
    category: ["restaurant_food", "restaurant_supplies"],
    clarifyingQuestions: [
      {
        question: "Which items are running low?",
        options: ["Frying oil", "To-go boxes", "Napkins", "Several items — I'll list them"],
      },
      {
        question: "How urgent is this restock?",
        options: ["Needed before tonight's service", "Within a few days", "Routine top-up"],
      },
    ],
    selectionRules:
      "Match each named item to the catalog by its usual search terms (e.g. 'frying oil 35lb'). Prefer trusted merchants at or below market price — a cheaper listing from an untrusted merchant will be denied by policy, so do not pick it. Order realistic bulk quantities.",
    approvalNote: "Routine restocks under the autopilot threshold auto-execute; unusual quantities or prices wait for human approval.",
  },
  {
    id: "software_api",
    title: "Software / API",
    emoji: "🧩",
    examplePrompt: "I need a geocoding API for about 50k requests a month",
    category: ["software"],
    clarifyingQuestions: [
      {
        question: "Roughly how many requests per month do you need?",
        options: ["Under 10k", "10k–100k", "100k–1M", "Not sure yet"],
      },
      {
        question: "What's your monthly budget?",
        options: ["Under $20", "$20–$50", "$50–$100"],
      },
    ],
    selectionRules:
      "Pick the cheapest plan whose requests_per_month covers the stated volume from a trusted merchant. The user does not want subscriptions: avoid recurring=true products unless no one-time option covers the need, and say so explicitly if you must propose one.",
    approvalNote: "Recurring purchases and amounts above the threshold always wait for human approval.",
  },
  {
    id: "external_website",
    title: "Buy from a website",
    emoji: "🌐",
    examplePrompt: "Buy the ceramic mug from shop.example.com for $18",
    category: [],
    clarifyingQuestions: [
      {
        question: "What is the exact product page URL?",
        options: ["I'll paste the link"],
      },
      {
        question: "What price does the website show?",
        options: ["I'll type the price"],
      },
    ],
    selectionRules:
      "Only for a real website the user explicitly named — never invent a site or URL. First call check_merchant on the domain and report its verification status and live trust score. Then propose_external_purchase with the exact https URL, item name, and the user-stated price in cents. Never claim the site is verified unless check_merchant said so.",
    approvalNote:
      "External purchases are NEVER auto-approved: the price is recorded as 'UNVERIFIED PRICE — agent-claimed' and a human must approve in the dashboard.",
  },
];

function formatQuestion(q: PlaybookQuestion): string {
  return `"${q.question}" (options: ${q.options.join(" / ")})`;
}

function formatPlaybook(p: Playbook): string {
  const categories = p.category.length > 0 ? p.category.join(", ") : "any non-blocked category";
  const questions =
    p.clarifyingQuestions.length > 0
      ? p.clarifyingQuestions.map((q, i) => `  ${i + 1}. ${formatQuestion(q)}`).join("\n")
      : "  (none)";
  return [
    `### ${p.emoji} ${p.title} (id: ${p.id})`,
    `Trigger example: "${p.examplePrompt}"`,
    `Categories: ${categories}`,
    `Clarifying questions (ask via ask_user, skip any the user already answered):`,
    questions,
    `Selection rules: ${p.selectionRules}`,
    `Approval note: ${p.approvalNote}`,
  ].join("\n");
}

/**
 * Builds the playbook section of the concierge system prompt: detect the playbook from the
 * user's message, interview via ask_user, then search and propose. Policy always decides.
 */
export function buildConciergeSystemPrompt(playbooks: readonly Playbook[]): string {
  return [
    "## Purchase playbooks",
    "",
    "Detect which playbook below best matches the user's message (use the trigger example and categories as cues).",
    "Then run that playbook:",
    "1. Ask its clarifying questions one at a time with ask_user, passing the suggested options as quick-reply chips.",
    "   SKIP any question the user has already answered in the conversation. Never ask more than 3 questions total.",
    "2. Search the catalog in the playbook's categories and apply its selection rules to pick the best product.",
    "3. Explain your pick in one paragraph, then propose it.",
    "",
    "Hard rules across all playbooks:",
    "- Never invent prices: only cite authoritative prices returned by tools.",
    "- You only propose — the deterministic AgentLedger policy decides whether a purchase executes, waits for human approval, or is denied. Relay the playbook's approval note so the user knows what to expect.",
    "- If no playbook matches, just help conversationally and use the tools directly.",
    "",
    ...playbooks.map(formatPlaybook),
  ].join("\n");
}

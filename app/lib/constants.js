/**
 * Shared constants. Safe to import from both server and client code.
 */

/**
 * AI crawlers checked against robots.txt.
 * purpose:
 *  - search:   indexes pages for AI answers. Blocking it stops citations.
 *  - user:     fetches a page when a person asks an assistant about it.
 *  - training: collects data for model training. Merchant's choice; never "fixed".
 */
export const AI_CRAWLERS = [
  {
    agent: "OAI-SearchBot",
    tool: "ChatGPT",
    usedFor: "ChatGPT search answers",
    purpose: "search",
  },
  {
    agent: "ChatGPT-User",
    tool: "ChatGPT",
    usedFor: "Pages ChatGPT opens for a shopper",
    purpose: "user",
  },
  {
    agent: "PerplexityBot",
    tool: "Perplexity",
    usedFor: "Perplexity answers",
    purpose: "search",
  },
  {
    agent: "Perplexity-User",
    tool: "Perplexity",
    usedFor: "Pages Perplexity opens for a shopper",
    purpose: "user",
  },
  {
    agent: "Claude-SearchBot",
    tool: "Claude",
    usedFor: "Claude search answers",
    purpose: "search",
  },
  {
    agent: "Claude-User",
    tool: "Claude",
    usedFor: "Pages Claude opens for a shopper",
    purpose: "user",
  },
  {
    agent: "Googlebot",
    tool: "Google",
    usedFor: "Google Search, AI Overviews and Gemini",
    purpose: "search",
  },
  {
    agent: "Bingbot",
    tool: "Microsoft",
    usedFor: "Bing and Microsoft Copilot",
    purpose: "search",
  },
  {
    agent: "GPTBot",
    tool: "OpenAI",
    usedFor: "OpenAI model training",
    purpose: "training",
  },
  {
    agent: "ClaudeBot",
    tool: "Anthropic",
    usedFor: "Anthropic model training",
    purpose: "training",
  },
  {
    agent: "Google-Extended",
    tool: "Google",
    usedFor: "Gemini model training",
    purpose: "training",
  },
  {
    agent: "CCBot",
    tool: "Common Crawl",
    usedFor: "Open dataset used for training",
    purpose: "training",
  },
  {
    agent: "Applebot-Extended",
    tool: "Apple",
    usedFor: "Apple Intelligence model training",
    purpose: "training",
  },
  {
    agent: "Meta-ExternalAgent",
    tool: "Meta",
    usedFor: "Meta AI model training",
    purpose: "training",
  },
];

/** User agents sent by the reachability check, one per AI search and assistant bot. */
export const BOT_USER_AGENTS = {
  "OAI-SearchBot":
    "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; OAI-SearchBot/1.0; +https://openai.com/searchbot)",
  "ChatGPT-User":
    "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; ChatGPT-User/1.0; +https://openai.com/bot",
  PerplexityBot:
    "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; PerplexityBot/1.0; +https://perplexity.ai/perplexitybot)",
  "Perplexity-User":
    "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Perplexity-User/1.0; +https://perplexity.ai/perplexity-user)",
  "Claude-SearchBot":
    "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Claude-SearchBot/1.0; +https://www.anthropic.com)",
  "Claude-User":
    "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Claude-User/1.0; +https://www.anthropic.com)",
  Googlebot:
    "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
  Bingbot:
    "Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)",
};

export const FIXABLE_CRAWLER_PURPOSES = ["search", "user"];

export const SYNC_STEPS = [
  { key: "catalog", label: "Products and collections" },
  { key: "policies", label: "Shipping, refund and privacy policies" },
  { key: "robots", label: "Live robots.txt" },
  { key: "llms", label: "Live llms.txt and agents.md" },
  { key: "schema", label: "Product schema" },
];

/** Steps re-run after fixes are applied (catalog data is already current). */
export const VERIFY_STEPS = ["robots", "llms", "schema"];

export const SYNC_MODE = { FULL: "full", VERIFY: "verify", RETRY: "retry" };
export const RUN_STATUS = {
  RUNNING: "running",
  COMPLETED: "completed",
  FAILED: "failed",
};
export const STEP_STATUS = {
  PENDING: "pending",
  RUNNING: "running",
  DONE: "done",
  FAILED: "failed",
  SKIPPED: "skipped",
};
export const FIX_STATUS = {
  NONE: "none",
  APPLIED: "applied",
  MANUAL: "manual",
  FAILED: "failed",
};

export const LIMITS = {
  /** Product pages fetched per scan. Larger catalogs are sampled. */
  maxSchemaScan: 250,
  /** Concurrent storefront requests during the scan. */
  scanConcurrency: 5,
  /** Products listed in llms.txt. */
  llmsProducts: 25,
  /** Collections listed in llms.txt. */
  llmsCollections: 30,
};

export const THEME_FILES = {
  robots: "templates/robots.txt.liquid",
  llms: "templates/llms.txt.liquid",
  settings: "config/settings_data.json",
};

/** Handle of the app embed block (extensions/geo-schema/blocks/geo-schema.liquid). */
export const APP_EMBED_HANDLE = "geo-schema";

/** App-data metafield read by the app embed via app.metafields.geo.schema. */
export const SCHEMA_METAFIELD = { namespace: "geo", key: "schema" };

export const GEO_MARKER = "Managed by GEO app";

// ─── Track: AI citation tracking ──────────────────────────────────────────────

export const TRACK = {
  /** Prompts a store can track. Every prompt is asked to every tool, every week. */
  maxPrompts: 10,
  /** Suggestions written per request. */
  suggestions: 12,
  defaultAnswers: 2,
  maxAnswers: 3,
  intervalDays: 7,
  reportWeeks: 4,
  /** Answers older than this are deleted. */
  keepWeeks: 8,
  /** Requests in flight per AI tool during a run. */
  concurrencyPerTool: 2,
};

export const TRACK_TRIGGER = {
  WEEKLY: "weekly",
  MANUAL: "manual",
};

export const TOOL_STATUS = { CONNECTED: "connected", ERROR: "error" };

export const PROMPT_KINDS = {
  category: "Category",
  product: "Product",
  brand: "Brand",
  gift: "Gift",
  location: "Location",
  custom: "Your prompt",
};

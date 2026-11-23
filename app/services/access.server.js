/**
 * AI access hub: crawler controls, the bot reachability check, agent
 * readiness checks (including the store's public Catalog MCP) and the
 * sitemap check. Results of slow checks are kept in Store.accessState.
 */
import prisma from "../db.server";
import { ACTOR, recordChange } from "./changes.server";
import { samplePaths } from "./scan.server";
import { patchStoreJson, updateFixState, updateStore } from "./store.server";
import { fetchStorefront, mapLimit, withCacheBuster } from "./storefront.server";
import { getLatestAudit, startSync } from "./sync.server";
import { getMainTheme, readThemeFiles, writeThemeFile } from "./theme.server";
import { auditRobots } from "../lib/audit";
import {
  AI_CRAWLERS,
  BOT_USER_AGENTS,
  FIX_STATUS,
  FIXABLE_CRAWLER_PURPOSES,
  SYNC_MODE,
  THEME_FILES,
} from "../lib/constants";
import { analyzeBotPage, readSitemap } from "../lib/pageCheck";
import { REQUIRED_POLICIES } from "../lib/policies";
import { isManagedRobotsTemplate, planRobotsFix } from "../lib/robots";
import { SHORT_DESCRIPTION_CHARS } from "../lib/issues";

export const SEARCH_BOTS = AI_CRAWLERS.filter((crawler) =>
  FIXABLE_CRAWLER_PURPOSES.includes(crawler.purpose),
);
export const TRAINING_BOTS = AI_CRAWLERS.filter(
  (crawler) => crawler.purpose === "training",
);

// ─── Crawler controls ─────────────────────────────────────────────────────────

/** Live robots.txt, the theme template and each crawler's access. */
export async function getCrawlerState(admin, shop, store) {
  const theme = await getMainTheme(admin);
  const url = `${store.url}/robots.txt`;
  const [live, files, paths] = await Promise.all([
    fetchStorefront(withCacheBuster(url)),
    readThemeFiles(admin, theme.id, [THEME_FILES.robots]),
    samplePaths(shop),
  ]);
  const template = files[THEME_FILES.robots];
  const robots = live.ok
    ? auditRobots({ text: live.text, samplePaths: paths })
    : auditRobots({ error: live.error || `HTTP ${live.status}` });

  return {
    url,
    theme,
    live: { ok: live.ok, status: live.status, text: live.ok ? live.text : null },
    template: {
      exists: template != null,
      managed: isManagedRobotsTemplate(template),
      content: template,
    },
    robots,
    paths,
    saved: {
      agents: store.fixState.robots?.agents ?? [],
      blocked: store.fixState.robots?.blocked ?? [],
    },
  };
}

/**
 * The robots.txt.liquid change for a set of training-bot choices. Search and
 * assistant bots that are blocked today are always let in.
 * @param {Record<string, "allow"|"block">} choices training bot -> choice
 */
export function planCrawlerChange(state, choices) {
  const block = TRAINING_BOTS.filter(
    (bot) => choices[bot.agent] === "block",
  ).map((bot) => bot.agent);
  const allowTraining = TRAINING_BOTS.filter((bot) => {
    const current = state.robots.crawlers.find((item) => item.agent === bot.agent);
    return choices[bot.agent] === "allow" && current && !current.allowed;
  }).map((bot) => bot.agent);
  const agents = [
    ...new Set([
      ...state.robots.blocked,
      ...state.saved.agents.filter((agent) =>
        SEARCH_BOTS.some((bot) => bot.agent === agent),
      ),
      ...allowTraining,
    ]),
  ];
  const plan = planRobotsFix({
    template: state.template.content,
    liveText: state.live.text ?? "",
    agents,
    block,
    paths: state.paths,
  });
  return { ...plan, agents, block };
}

/** Writes the crawler choices to the live theme and re-checks the store. */
export async function applyCrawlerChange(admin, shop, store, choices) {
  const state = await getCrawlerState(admin, shop, store);
  if (!state.live.ok)
    throw new Error("robots.txt couldn't be read, so it can't be changed safely.");
  const plan = planCrawlerChange(state, choices);
  if (!plan.changed) return { status: "unchanged", plan };

  try {
    await writeThemeFile(admin, state.theme.id, THEME_FILES.robots, plan.content);
  } catch (error) {
    if (error.isAccessDenied) {
      await updateStore(shop, { robotsStatus: FIX_STATUS.MANUAL });
      await updateFixState(shop, "robots", {
        agents: plan.agents,
        blocked: plan.block,
        themeId: state.theme.id,
        manual: { filename: THEME_FILES.robots, content: plan.content },
        message:
          "Shopify didn't allow the app to edit theme files. Add the template once by hand.",
      });
      return { status: FIX_STATUS.MANUAL, plan };
    }
    throw error;
  }

  const summary = [
    plan.agents.length && `allowed ${plan.agents.join(", ")}`,
    plan.block.length && `blocked ${plan.block.join(", ")}`,
  ]
    .filter(Boolean)
    .join("; ");
  await recordChange(shop, {
    area: "robots",
    title: `Crawler rules: ${summary || "reset to your theme's rules"}`,
    detail: `${THEME_FILES.robots} · theme ${state.theme.name}`,
    items: plan.agents.length + plan.block.length || 1,
    actor: ACTOR.MERCHANT,
    before: {
      kind: "themeFile",
      themeId: state.theme.id,
      filename: THEME_FILES.robots,
      content: state.template.content,
    },
  });
  await updateStore(shop, { robotsStatus: FIX_STATUS.APPLIED });
  await updateFixState(shop, "robots", {
    agents: plan.agents,
    blocked: plan.block,
    themeId: state.theme.id,
    manual: null,
    message: null,
  });
  await startSync(shop, { mode: SYNC_MODE.VERIFY });
  return { status: FIX_STATUS.APPLIED, plan };
}

// ─── Reachability ─────────────────────────────────────────────────────────────

const PAGE_TYPES = [
  ["home", "Home"],
  ["product", "Product"],
  ["collection", "Collection"],
  ["policy", "Policy"],
];

async function samplePages(shop, store) {
  const [product, collection] = await Promise.all([
    prisma.product.findFirst({
      where: { shop, status: "ACTIVE", url: { not: null }, isGiftCard: false },
      orderBy: { updatedAt: "desc" },
      select: { handle: true },
    }),
    prisma.collection.findFirst({
      where: { shop, productsCount: { gt: 0 } },
      select: { handle: true },
    }),
  ]);
  const policyUrl = store.policies?.[0]?.url;
  let policyPath = null;
  try {
    policyPath = policyUrl ? new URL(policyUrl).pathname : null;
  } catch {
    policyPath = null;
  }
  return {
    home: "/",
    product: product ? `/products/${product.handle}` : null,
    collection: collection ? `/collections/${collection.handle}` : null,
    policy: policyPath,
  };
}

/**
 * Fetches a home, product, collection and policy page as each AI search and
 * assistant bot, and records what came back.
 */
export async function runReachabilityCheck(shop, store) {
  const pages = await samplePages(shop, store);
  const jobs = [];
  for (const bot of SEARCH_BOTS) {
    const userAgent = BOT_USER_AGENTS[bot.agent];
    if (!userAgent) continue;
    for (const [type] of PAGE_TYPES) {
      if (!pages[type]) continue;
      jobs.push({ agent: bot.agent, type, path: pages[type], userAgent });
    }
  }

  const results = await mapLimit(jobs, 4, async (job) => {
    const response = await fetchStorefront(
      withCacheBuster(`${store.url}${job.path}`),
      { userAgent: job.userAgent, retries: 1, timeoutMs: 12_000 },
    );
    return { ...job, ms: response.ms, ...analyzeBotPage(response) };
  });

  const bots = SEARCH_BOTS.filter((bot) => BOT_USER_AGENTS[bot.agent]).map((bot) => {
    const rows = results.filter((row) => row.agent === bot.agent);
    const okRows = rows.filter((row) => row.outcome === "ok");
    return {
      agent: bot.agent,
      tool: bot.tool,
      purpose: bot.purpose,
      pages: Object.fromEntries(
        rows.map((row) => [
          row.type,
          { status: row.status, outcome: row.outcome, note: row.note, ms: row.ms },
        ]),
      ),
      avgMs: okRows.length
        ? Math.round(okRows.reduce((sum, row) => sum + row.ms, 0) / okRows.length)
        : null,
      seen: [...new Set(okRows.flatMap((row) => row.seen))],
      ok: rows.length > 0 && okRows.length === rows.length,
    };
  });

  const reachability = {
    checkedAt: new Date().toISOString(),
    pages,
    bots,
    fetches: results.length,
    failures: results.filter((row) => row.outcome !== "ok").length,
  };
  await patchStoreJson(shop, "accessState", { reachability });
  return reachability;
}

export const REACHABILITY_PAGE_TYPES = PAGE_TYPES;

// ─── Agent readiness ──────────────────────────────────────────────────────────

/** Calls a tool on the store's public Storefront MCP endpoint (JSON-RPC). */
async function callStorefrontMcp(storeUrl, method, params) {
  const started = Date.now();
  const response = await fetch(`${storeUrl}/api/mcp`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(15_000),
  });
  const json = await response.json().catch(() => null);
  const ms = Date.now() - started;
  if (!response.ok || !json)
    throw Object.assign(new Error(`HTTP ${response.status}`), { ms });
  if (json.error)
    throw Object.assign(new Error(json.error.message || "MCP error"), { ms });
  return { result: json.result, ms };
}

/** Product records in a search_shop_catalog result, whatever shape the text holds. */
function parseCatalogResult(result) {
  const texts = (result?.content ?? [])
    .filter((item) => item.type === "text")
    .map((item) => item.text);
  for (const text of texts) {
    try {
      const data = JSON.parse(text);
      const products = data.products ?? data.results ?? (Array.isArray(data) ? data : null);
      if (Array.isArray(products)) return products;
    } catch {
      // Not JSON: try the next block.
    }
  }
  return [];
}

function productView(item) {
  const price =
    item.price_range?.min ??
    item.priceRange?.minVariantPrice?.amount ??
    item.variants?.[0]?.price ??
    item.price ??
    null;
  const currency =
    item.price_range?.currency ??
    item.priceRange?.minVariantPrice?.currencyCode ??
    item.variants?.[0]?.currency ??
    null;
  return {
    id: item.product_id ?? item.id ?? null,
    title: item.title ?? item.name ?? "Untitled",
    url: item.url ?? item.onlineStoreUrl ?? null,
    price: typeof price === "object" ? price?.amount : price,
    currency,
    available: item.available ?? item.availableForSale ?? null,
    variants: Array.isArray(item.variants) ? item.variants.length : null,
    description: String(item.description ?? "").slice(0, 160),
  };
}

/** "Test as an agent": searches the store's Catalog MCP like a shopping agent. */
export async function testAsAgent(store, query) {
  const { result, ms } = await callStorefrontMcp(store.url, "tools/call", {
    name: "search_shop_catalog",
    arguments: { query, context: "A shopper asking an AI assistant" },
  });
  const products = parseCatalogResult(result).slice(0, 10).map(productView);
  const local = products.length
    ? await prisma.product.findMany({
        where: {
          shop: store.shop,
          OR: products
            .filter((item) => item.id)
            .map((item) => ({ id: String(item.id) })),
        },
        select: {
          id: true,
          category: true,
          descriptionChars: true,
          gtinCount: true,
        },
      })
    : [];
  return {
    ms,
    products: products.map((item) => {
      const row = local.find((product) => product.id === String(item.id));
      const gaps = row
        ? [
            !row.category && "No category",
            row.descriptionChars < SHORT_DESCRIPTION_CHARS && "Thin description",
            !row.gtinCount && "No GTIN",
          ].filter(Boolean)
        : [];
      return { ...item, gaps };
    }),
  };
}

async function probe(url) {
  const response = await fetchStorefront(withCacheBuster(url), { retries: 1, timeoutMs: 10_000 });
  return { ok: response.ok && !response.redirected, status: response.status, text: response.text, ms: response.ms };
}

/** Eleven checks a shopping agent depends on. Saved in accessState.agents. */
export async function runAgentChecks(shop, store) {
  const where = { shop, status: "ACTIVE", isGiftCard: false };
  const [audit, products, complete, giftCards, facts, ucp, agentsMd, mcp] =
    await Promise.all([
      getLatestAudit(shop),
      prisma.product.count({ where }),
      prisma.product.count({
        where: {
          ...where,
          category: { not: null },
          descriptionChars: { gte: SHORT_DESCRIPTION_CHARS },
          gtinCount: { gt: 0 },
        },
      }),
      prisma.product.count({ where: { shop, isGiftCard: true } }),
      prisma.brandFact.count({ where: { shop } }),
      probe(`${store.url}/.well-known/ucp`),
      probe(`${store.url}/agents.md`),
      callStorefrontMcp(store.url, "tools/list", {}).then(
        (value) => ({ ok: true, ms: value.ms, tools: (value.result?.tools ?? []).map((tool) => tool.name) }),
        (error) => ({ ok: false, ms: error.ms ?? null, error: error.message }),
      ),
    ]);
  const facts_ = store.shopFacts ?? {};
  const policies = facts_.policyTypes ?? [];
  const present = REQUIRED_POLICIES.filter((policy) => policies.includes(policy.type));

  const checks = [
    {
      key: "public",
      label: "Storefront is public",
      status: audit?.passwordProtected ? "attention" : "pass",
      detail: audit?.passwordProtected ? "A password page blocks agents" : "No password page",
    },
    {
      key: "policies",
      label: "Required policies",
      status: present.length === REQUIRED_POLICIES.length ? "pass" : "attention",
      detail:
        present.length === REQUIRED_POLICIES.length
          ? "Terms, privacy and refund policies are set"
          : `Missing ${REQUIRED_POLICIES.filter((policy) => !present.includes(policy)).map((policy) => policy.label.toLowerCase()).join(", ")}`,
      href: present.length === REQUIRED_POLICIES.length ? null : "/app/fixes/policies.missing",
    },
    {
      key: "returnWindow",
      label: "Refund policy states a window",
      status: facts_.refundWindowDays ? "pass" : "attention",
      detail: facts_.refundWindowDays
        ? `${facts_.refundWindowDays} days`
        : "Agents can't answer “how long to return?”",
      href: facts_.refundWindowDays ? null : "/app/fixes/policies.returnWindow",
    },
    {
      key: "catalog",
      label: "Products agents can list",
      status: products > 0 ? "pass" : "attention",
      detail: `${products.toLocaleString("en-US")} active products${giftCards ? ` · ${giftCards} gift cards excluded` : ""}`,
    },
    {
      key: "ucp",
      label: "UCP discovery file",
      status: ucp.ok ? "pass" : "info",
      detail: ucp.ok
        ? `/.well-known/ucp · HTTP ${ucp.status}`
        : `/.well-known/ucp not served (HTTP ${ucp.status || "error"}). Shopify publishes it for stores in its agentic program.`,
    },
    {
      key: "mcp",
      label: "Storefront Catalog MCP",
      status: mcp.ok ? "pass" : "attention",
      detail: mcp.ok
        ? `Responding in ${(mcp.ms / 1000).toFixed(1)} s · ${mcp.tools.length} tools`
        : `/api/mcp didn't answer: ${mcp.error}`,
    },
    {
      key: "agentsMd",
      label: "agents.md served",
      status: agentsMd.ok ? "pass" : "info",
      detail: agentsMd.ok ? "Served at /agents.md" : `Not served (HTTP ${agentsMd.status || "error"})`,
      href: "/app/access/llms",
    },
    {
      key: "fields",
      label: "Fields agents rely on",
      status: products && complete / products >= 0.8 ? "pass" : "attention",
      detail: `${complete.toLocaleString("en-US")} of ${products.toLocaleString("en-US")} products have a category, a full description and a GTIN`,
      href: "/app/fixes",
    },
    {
      key: "markets",
      label: "Markets and currency",
      status: "pass",
      detail: `${store.currency ?? "Unknown currency"} · ships to ${(facts_.shipsTo ?? []).length} countries`,
    },
    {
      key: "checkout",
      label: "Guest checkout",
      status: "manual",
      detail: "Apps can't read this setting",
      href: "shopify://admin/settings/checkout",
    },
    {
      key: "facts",
      label: "Store facts for agents",
      status: facts >= 3 ? "pass" : "attention",
      detail: facts ? `${facts} brand facts recorded` : "No brand facts yet",
      href: "/app/access/brand",
    },
  ];

  const agents = {
    checkedAt: new Date().toISOString(),
    checks,
    products,
    complete,
    mcp: { ok: mcp.ok, ms: mcp.ms, tools: mcp.tools ?? [] },
    ucp: { ok: ucp.ok, status: ucp.status },
  };
  await patchStoreJson(shop, "accessState", { agents });
  return agents;
}

// ─── Sitemap ──────────────────────────────────────────────────────────────────

export async function checkSitemap(store) {
  const response = await fetchStorefront(withCacheBuster(`${store.url}/sitemap.xml`));
  const index = response.ok ? readSitemap(response.text) : null;
  return {
    url: `${store.url}/sitemap.xml`,
    ok: response.ok,
    status: response.status,
    children: index?.children.length ?? 0,
    kinds: index?.kinds ?? {},
    checkedAt: new Date().toISOString(),
  };
}

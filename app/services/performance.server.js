/**
 * AI performance: orders and sales that arrived from AI assistants, read from
 * each order's customer journey (read_orders). Results are cached per shop
 * for a few minutes because a range can span many order pages.
 */
import { AdminApiError, gql } from "./admin.server";
import { AI_PLATFORMS, classifyVisit, landingPath } from "../lib/aiReferrers";

const DAY_MS = 86_400_000;
const CACHE_MS = 15 * 60_000;
const MAX_PAGES = 30;
/** How far back Shopify returns orders without the read_all_orders scope. */
const ORDER_WINDOW_DAYS = 60;

const cache = global.__geoPerformanceCache ?? (global.__geoPerformanceCache = new Map());

const ORDERS_QUERY = `#graphql
  query GeoAiOrders($after: String, $query: String!) {
    orders(first: 100, after: $after, query: $query, sortKey: CREATED_AT, reverse: true) {
      nodes {
        id
        name
        createdAt
        totalPriceSet {
          shopMoney {
            amount
            currencyCode
          }
        }
        customerJourneySummary {
          firstVisit {
            referrerUrl
            source
            landingPage
            utmParameters {
              source
            }
          }
          lastVisit {
            referrerUrl
            source
            landingPage
            utmParameters {
              source
            }
          }
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }`;

const isoDate = (date) => date.toISOString().slice(0, 10);

/** Explains a failed orders query in terms the merchant can act on. */
function unavailableReason(error) {
  const message = error instanceof AdminApiError ? error.message : String(error?.message ?? error);
  if (/not approved to access|protected customer data/i.test(message))
    return {
      reason: "approval",
      message:
        "Shopify hasn't approved this app to read order data yet. In the Partner Dashboard, open the app's API access and request protected customer data access for orders.",
    };
  if (/access denied|read_orders|scope/i.test(message))
    return {
      reason: "scope",
      message:
        "GEO needs permission to read orders. Reopen the app and accept the updated permissions.",
    };
  return { reason: "error", message };
}

async function fetchOrders(admin, since) {
  const orders = [];
  let after = null;
  let truncated = false;
  for (let page = 0; page < MAX_PAGES; page++) {
    const data = await gql(admin, ORDERS_QUERY, {
      after,
      query: `created_at:>=${isoDate(since)}`,
    });
    orders.push(...data.orders.nodes);
    if (!data.orders.pageInfo.hasNextPage) return { orders, truncated };
    after = data.orders.pageInfo.endCursor;
    if (page === MAX_PAGES - 1) truncated = true;
  }
  return { orders, truncated };
}

function visitOf(summary) {
  // Last-touch first: the visit that led to the order, then the first one.
  for (const visit of [summary?.lastVisit, summary?.firstVisit]) {
    if (!visit) continue;
    const platform = classifyVisit({
      referrerUrl: visit.referrerUrl,
      source: visit.source,
      utmSource: visit.utmParameters?.source,
    });
    if (platform) return { platform, landingPage: visit.landingPage };
  }
  return null;
}

/**
 * Orders from AI assistants in the last `days`, by platform and landing page,
 * with the previous period for comparison.
 */
export async function getAiPerformance(admin, shop, { days = 30, refresh = false } = {}) {
  const key = `${shop}:${days}`;
  const cached = cache.get(key);
  if (!refresh && cached && Date.now() - cached.at < CACHE_MS) return cached.value;

  const now = Date.now();
  // Without read_all_orders, Shopify only returns the last 60 days of orders,
  // so a previous period can only be compared when both periods fit in it.
  const comparable = 2 * days <= ORDER_WINDOW_DAYS;
  const since = new Date(now - (comparable ? 2 : 1) * days * DAY_MS);
  let fetched;
  try {
    fetched = await fetchOrders(admin, since);
  } catch (error) {
    console.warn(`[geo] AI performance for ${shop} unavailable: ${error.message}`);
    return { available: false, ...unavailableReason(error) };
  }

  const windowStart = now - days * DAY_MS;
  const periods = { current: [], previous: [] };
  let currency = null;
  let totalOrders = 0;
  let totalSales = 0;

  for (const order of fetched.orders) {
    const created = new Date(order.createdAt).getTime();
    const money = order.totalPriceSet?.shopMoney;
    const amount = Number.parseFloat(money?.amount) || 0;
    currency ??= money?.currencyCode ?? null;
    const visit = visitOf(order.customerJourneySummary);
    if (created >= windowStart) {
      totalOrders += 1;
      totalSales += amount;
    }
    if (!visit) continue;
    const row = {
      id: order.id,
      name: order.name,
      createdAt: order.createdAt,
      amount,
      platform: visit.platform.id,
      landingPage: landingPath(visit.landingPage),
    };
    (created >= windowStart ? periods.current : periods.previous).push(row);
  }

  const sum = (rows) => rows.reduce((total, row) => total + row.amount, 0);
  const byPlatform = AI_PLATFORMS.map((platform) => {
    const rows = periods.current.filter((row) => row.platform === platform.id);
    const before = periods.previous.filter((row) => row.platform === platform.id);
    return {
      id: platform.id,
      name: platform.name,
      orders: rows.length,
      sales: sum(rows),
      previousOrders: comparable ? before.length : null,
    };
  }).filter((row) => row.orders || row.previousOrders);

  const pages = new Map();
  for (const row of periods.current) {
    if (!row.landingPage) continue;
    const page = pages.get(row.landingPage) ?? { path: row.landingPage, orders: 0, sales: 0, platforms: new Set() };
    page.orders += 1;
    page.sales += row.amount;
    page.platforms.add(row.platform);
    pages.set(row.landingPage, page);
  }

  const weeks = Math.max(1, Math.round(days / 7));
  const weekly = Array.from({ length: weeks }, (_, index) => {
    const start = now - (weeks - index) * 7 * DAY_MS;
    const end = start + 7 * DAY_MS;
    const rows = periods.current.filter((row) => {
      const created = new Date(row.createdAt).getTime();
      return created >= start && created < end;
    });
    return { start: new Date(start), orders: rows.length, sales: sum(rows) };
  });

  const value = {
    available: true,
    days,
    currency,
    truncated: fetched.truncated,
    orders: periods.current.length,
    sales: sum(periods.current),
    comparable,
    previousOrders: comparable ? periods.previous.length : null,
    previousSales: comparable ? sum(periods.previous) : null,
    totalOrders,
    totalSales,
    byPlatform,
    landingPages: [...pages.values()]
      .sort((a, b) => b.orders - a.orders)
      .slice(0, 10)
      .map((page) => ({
        ...page,
        platforms: [...page.platforms].map(
          (id) => AI_PLATFORMS.find((platform) => platform.id === id)?.name ?? id,
        ),
      })),
    recent: periods.current.slice(0, 10).map((row) => ({
      ...row,
      platformName: AI_PLATFORMS.find((platform) => platform.id === row.platform)?.name,
    })),
    weekly,
    checkedAt: new Date(),
  };
  cache.set(key, { at: Date.now(), value });
  return value;
}

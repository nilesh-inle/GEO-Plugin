/**
 * Reads what AI crawlers see on the live storefront. Each function returns a
 * plain object stored in SyncRun.scan and consumed by app/lib/audit.js.
 */
import prisma from "../db.server";
import { LIMITS, THEME_FILES } from "../lib/constants";
import { parseJson } from "../lib/format";
import { analyzeHomePage, analyzeProductPage } from "../lib/jsonld";
import { isManagedLlmsTemplate } from "../lib/llms";
import { isManagedRobotsTemplate } from "../lib/robots";
import {
  fetchStorefront,
  mapLimit,
  withCacheBuster,
} from "./storefront.server";
import { getAppEmbedStatus, readThemeFiles } from "./theme.server";

const MAX_STORED_TEXT = 60_000;

const pickResponse = (response) => ({
  ok: response.ok,
  status: response.status,
  finalUrl: response.finalUrl,
  redirected: response.redirected,
  text: response.ok ? response.text.slice(0, MAX_STORED_TEXT) : "",
  error: response.error ?? null,
});

/** Home page: password protection and Organization schema. */
export async function scanStorefront(storeUrl) {
  const home = await fetchStorefront(withCacheBuster(`${storeUrl}/`));
  const passwordProtected =
    home.ok && new URL(home.finalUrl).pathname.startsWith("/password");
  return {
    url: storeUrl,
    reachable: home.ok,
    passwordProtected,
    home: home.ok && !passwordProtected ? analyzeHomePage(home.text) : null,
    error: home.ok ? null : home.error || `HTTP ${home.status}`,
  };
}

/** Paths each crawler is tested against: home, a product and a collection. */
export async function samplePaths(shop) {
  const [product, collection] = await Promise.all([
    prisma.product.findFirst({
      where: { shop, status: "ACTIVE", url: { not: null } },
      select: { handle: true },
    }),
    prisma.collection.findFirst({
      where: { shop, productsCount: { gt: 0 } },
      select: { handle: true },
    }),
  ]);
  return [
    "/",
    product && `/products/${product.handle}`,
    collection && `/collections/${collection.handle}`,
  ].filter(Boolean);
}

export async function scanRobots({ admin, themeId, storeUrl, shop }) {
  const [live, files, paths] = await Promise.all([
    fetchStorefront(withCacheBuster(`${storeUrl}/robots.txt`)),
    readThemeFiles(admin, themeId, [THEME_FILES.robots]),
    samplePaths(shop),
  ]);
  if (!live.ok)
    throw new Error(
      `robots.txt returned ${live.error || `HTTP ${live.status}`}`,
    );

  const template = files[THEME_FILES.robots];
  return {
    ...pickResponse(live),
    samplePaths: paths,
    template: {
      exists: template != null,
      managed: isManagedRobotsTemplate(template),
    },
  };
}

export async function scanLlms({ admin, themeId, storeUrl }) {
  const [llms, agents, files] = await Promise.all([
    fetchStorefront(withCacheBuster(`${storeUrl}/llms.txt`)),
    fetchStorefront(withCacheBuster(`${storeUrl}/agents.md`)),
    readThemeFiles(admin, themeId, [THEME_FILES.llms]),
  ]);
  if (!llms.status)
    throw new Error(`llms.txt could not be fetched: ${llms.error}`);

  const template = files[THEME_FILES.llms];
  return {
    llms: pickResponse(llms),
    agents: pickResponse(agents),
    template: {
      exists: template != null,
      managed: isManagedLlmsTemplate(template),
    },
  };
}

/**
 * Fetches product pages and compares their JSON-LD with synced product data.
 * Large catalogs are sampled (LIMITS.maxSchemaScan, most recently updated first).
 */
export async function scanSchema({ admin, themeId, shop, onProgress }) {
  const where = { shop, status: "ACTIVE", url: { not: null } };
  const [sample, total, embedEnabled] = await Promise.all([
    prisma.product.findMany({
      where,
      select: {
        id: true,
        handle: true,
        url: true,
        prices: true,
        gtinCount: true,
        ratingCount: true,
      },
      orderBy: { updatedAt: "desc" },
      take: LIMITS.maxSchemaScan,
    }),
    prisma.product.count({ where }),
    getAppEmbedStatus(admin, themeId).catch(() => null),
  ]);

  let done = 0;
  onProgress?.(0, sample.length);
  const results = await mapLimit(
    sample,
    LIMITS.scanConcurrency,
    async (product) => {
      const page = await fetchStorefront(withCacheBuster(product.url));
      done += 1;
      onProgress?.(done, sample.length);

      if (!page.ok)
        return {
          id: product.id,
          handle: product.handle,
          ok: false,
          error: page.error || `HTTP ${page.status}`,
        };
      return {
        id: product.id,
        handle: product.handle,
        ok: true,
        storeGtin: product.gtinCount > 0,
        storeRating: product.ratingCount > 0,
        ...analyzeProductPage(page.text, parseJson(product.prices, [])),
      };
    },
  );

  return { embedEnabled, total, scanned: sample.length, products: results };
}

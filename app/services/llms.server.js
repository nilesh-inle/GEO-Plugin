/**
 * llms.txt generation from synced data, theme writes, and debounced refresh
 * after catalog webhooks.
 */
import prisma from "../db.server";
import { unauthenticated } from "../shopify.server";
import { FIX_STATUS, THEME_FILES } from "../lib/constants";
import { parseJson } from "../lib/format";
import { buildLlmsTxt, toLlmsTemplate } from "../lib/llms";
import {
  getStore,
  toStoreView,
  updateFixState,
  updateStore,
} from "./store.server";
import { getMainTheme, writeThemeFile } from "./theme.server";

const REFRESH_DELAY_MS = 60_000;
const timers =
  global.__geoLlmsTimers ?? (global.__geoLlmsTimers = new Map());

/**
 * Whether Shopify's own /agents.md was reachable in a recent scan. When it is,
 * the generated llms.txt links to it so replacing Shopify's default llms.txt
 * doesn't hide the store's agent discovery details.
 */
async function hasAgentsFile(shop) {
  const runs = await prisma.syncRun.findMany({
    where: { shop, status: "completed" },
    orderBy: { startedAt: "desc" },
    take: 5,
    select: { scan: true },
  });
  for (const run of runs) {
    const agents = parseJson(run.scan, {})?.llms?.agents;
    if (agents) return Boolean(agents.ok);
  }
  return false;
}

/** Builds llms.txt markdown from the database (no Admin API calls). */
export async function buildStoreLlms(shop) {
  const store = toStoreView(await getStore(shop));
  if (!store?.url)
    throw new Error("Store details are missing. Run a sync first.");

  const [products, collections, facts, agentsFile] = await Promise.all([
    prisma.product.findMany({
      where: { shop, status: "ACTIVE", url: { not: null } },
    }),
    prisma.collection.findMany({ where: { shop } }),
    prisma.brandFact.findMany({
      where: { shop },
      orderBy: [{ group: "asc" }, { createdAt: "asc" }],
    }),
    hasAgentsFile(shop),
  ]);
  return buildLlmsTxt({ store, products, collections, facts, agentsFile });
}

/** Writes templates/llms.txt.liquid to the live theme (or `themeId`). */
export async function regenerateLlms(admin, shop, { themeId } = {}) {
  const { markdown, stats } = await buildStoreLlms(shop);
  const targetTheme = themeId ?? (await getMainTheme(admin)).id;
  await writeThemeFile(
    admin,
    targetTheme,
    THEME_FILES.llms,
    toLlmsTemplate(markdown),
  );
  await updateStore(shop, { llmsDirty: false, llmsUpdatedAt: new Date() });
  await updateFixState(shop, "llms", { stats });
  return { markdown, stats };
}

/**
 * Called from catalog webhooks. Marks llms.txt stale and regenerates it once
 * after a quiet period, so a bulk edit causes one theme write, not hundreds.
 * If the process restarts first, `refreshLlmsIfDirty` catches up on the next visit.
 */
export async function markCatalogChanged(shop) {
  const store = await getStore(shop);
  if (
    !store ||
    store.llmsStatus !== FIX_STATUS.APPLIED ||
    !store.llmsAutoUpdate
  )
    return;
  if (!store.llmsDirty) await updateStore(shop, { llmsDirty: true });
  if (timers.has(shop)) return;

  timers.set(
    shop,
    setTimeout(async () => {
      timers.delete(shop);
      try {
        const { admin } = await unauthenticated.admin(shop);
        await regenerateLlms(admin, shop);
      } catch (error) {
        console.error(`[geo] llms.txt refresh failed for ${shop}`, error);
      }
    }, REFRESH_DELAY_MS),
  );
}

export async function refreshLlmsIfDirty(admin, store) {
  if (
    !store?.llmsDirty ||
    store.llmsStatus !== FIX_STATUS.APPLIED ||
    timers.has(store.shop)
  )
    return;
  await regenerateLlms(admin, store.shop).catch((error) =>
    console.error(`[geo] llms.txt refresh failed for ${store.shop}`, error),
  );
}

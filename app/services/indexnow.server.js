/**
 * IndexNow: tells Bing (which powers Copilot), Yandex, Naver, Seznam and Yep
 * that a page changed.
 *
 * IndexNow only accepts URLs at or below the folder of the key file, and
 * Shopify can't host a file at the store root. So the key text is served by
 * the app proxy at /apps/geo/indexnow/<key>.txt and a Shopify URL redirect
 * maps /<key>.txt to it. The root URL is what we send as `keyLocation`.
 */
import { randomBytes } from "node:crypto";
import prisma from "../db.server";
import { assertNoUserErrors, gql } from "./admin.server";
import { getStore, patchStoreJson, toStoreView } from "./store.server";

const ENDPOINT = "https://api.indexnow.org/indexnow";
const MAX_URLS = 1000;
const LOG_SIZE = 20;
/** The same URL is submitted at most once per this window. */
const REPEAT_MS = 10 * 60_000;

const recent = global.__geoIndexNowRecent ?? (global.__geoIndexNowRecent = new Map());

export const PROXY_PATH = "/apps/geo/indexnow";

/** Root-level key URL, so the key covers every page on the store. */
export function keyLocation(store, key) {
  return `${store.url}/${key}.txt`;
}

/**
 * Makes sure /<key>.txt redirects to the app proxy file. Needs the
 * write_online_store_navigation scope; returns { ok: false, needsScope: true }
 * when the merchant hasn't approved it yet.
 */
export async function ensureKeyRedirect(admin, key) {
  const path = `/${key}.txt`;
  try {
    const existing = await gql(
      admin,
      `#graphql
      query GeoIndexNowRedirect($query: String!) {
        urlRedirects(first: 1, query: $query) {
          nodes {
            id
            path
            target
          }
        }
      }`,
      { query: `path:${path}` },
    );
    const redirect = existing.urlRedirects.nodes[0];
    const target = `${PROXY_PATH}/${key}.txt`;
    if (redirect?.target === target) return { ok: true };

    const created = await gql(
      admin,
      `#graphql
      mutation GeoIndexNowRedirectCreate($redirect: UrlRedirectInput!) {
        urlRedirectCreate(urlRedirect: $redirect) {
          urlRedirect {
            id
          }
          userErrors {
            field
            message
          }
        }
      }`,
      { redirect: { path, target } },
    );
    assertNoUserErrors(created.urlRedirectCreate, "Creating the key redirect");
    return { ok: true };
  } catch (error) {
    if (error.isAccessDenied) return { ok: false, needsScope: true };
    return { ok: false, error: error.message };
  }
}

/** The store's IndexNow key, created on first use. */
export async function ensureKey(shop) {
  const store = toStoreView(await getStore(shop));
  if (store.settings.indexNowKey) return store.settings.indexNowKey;
  const key = randomBytes(16).toString("hex");
  await patchStoreJson(shop, "settings", { indexNowKey: key });
  return key;
}

/** Whether the key file is reachable on the storefront (app proxy set up). */
export async function verifyKeyFile(store, key) {
  try {
    const response = await fetch(keyLocation(store, key), {
      signal: AbortSignal.timeout(10_000),
      redirect: "follow",
    });
    const text = (await response.text()).trim();
    return { ok: response.ok && text === key, status: response.status };
  } catch (error) {
    return { ok: false, status: 0, error: error.message };
  }
}

const keyChecks = global.__geoIndexNowKeyChecks ?? (global.__geoIndexNowKeyChecks = new Map());

/** verifyKeyFile, remembered for 10 minutes when it succeeds. */
async function keyFileReady(store, key) {
  const cacheKey = `${store.shop}:${key}`;
  if (Date.now() - (keyChecks.get(cacheKey) ?? 0) < REPEAT_MS) return true;
  const result = await verifyKeyFile(store, key);
  if (result.ok) keyChecks.set(cacheKey, Date.now());
  return result.ok;
}

async function appendLog(shop, entry) {
  const store = toStoreView(await getStore(shop));
  const log = [entry, ...(store.settings.indexNowLog ?? [])].slice(0, LOG_SIZE);
  await patchStoreJson(shop, "settings", { indexNowLog: log });
}

/**
 * Submits URLs on the store's domain. Skips URLs submitted in the last
 * 10 minutes. Logs the response for the Indexing tab.
 */
export async function submitUrls(shop, urls, { trigger }) {
  const store = toStoreView(await getStore(shop));
  if (!store?.url) throw new Error("Run a sync first.");
  const key = await ensureKey(shop);
  const host = new URL(store.url).host;
  const now = Date.now();
  const fresh = [...new Set(urls)]
    .filter((url) => {
      try {
        return new URL(url).host === host;
      } catch {
        return false;
      }
    })
    .filter((url) => now - (recent.get(url) ?? 0) > REPEAT_MS)
    .slice(0, MAX_URLS);
  if (!fresh.length) return { submitted: 0, status: null };

  // IndexNow answers 202 before it checks the key, then silently drops
  // submissions whose key file can't be read. Check it first so a broken
  // setup shows up as an error instead of a false "accepted".
  if (!(await keyFileReady(store, key))) {
    const message =
      "The IndexNow key file can't be read on your store, so search engines would ignore this submission. Re-run IndexNow setup.";
    await appendLog(shop, {
      at: new Date().toISOString(),
      trigger,
      urls: fresh.length,
      sample: fresh[0],
      status: 0,
      error: message,
    });
    return { submitted: 0, status: 0, error: message };
  }

  let status = 0;
  let error = null;
  try {
    const response = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({
        host,
        key,
        keyLocation: keyLocation(store, key),
        urlList: fresh,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    status = response.status;
    if (!response.ok) error = (await response.text()).slice(0, 200) || `HTTP ${status}`;
  } catch (failure) {
    error = failure.message;
  }
  if (!error) for (const url of fresh) recent.set(url, now);
  await appendLog(shop, {
    at: new Date().toISOString(),
    trigger,
    urls: fresh.length,
    sample: fresh[0],
    status,
    error,
  });
  if (error) console.warn(`[geo] IndexNow for ${shop}: ${error}`);
  return { submitted: error ? 0 : fresh.length, status, error };
}

/** Every published product and collection URL, for a full submission. */
export async function catalogUrls(shop) {
  const store = await getStore(shop);
  const [products, collections] = await Promise.all([
    prisma.product.findMany({
      where: { shop, status: "ACTIVE", url: { not: null } },
      select: { handle: true },
    }),
    prisma.collection.findMany({ where: { shop }, select: { handle: true } }),
  ]);
  return [
    `${store.url}/`,
    ...collections.map((item) => `${store.url}/collections/${item.handle}`),
    ...products.map((item) => `${store.url}/products/${item.handle}`),
  ];
}

/** Called from catalog webhooks when the automation is on. Never throws. */
export async function submitChanged(shop, url, trigger) {
  try {
    const store = toStoreView(await getStore(shop));
    if (!store?.settings?.indexNow || !store.settings.indexNowKey || !url) return;
    await submitUrls(shop, [url], { trigger });
  } catch (error) {
    console.error(`[geo] IndexNow submit for ${shop} failed`, error);
  }
}

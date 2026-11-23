/**
 * Loader/action guard for screens that need a synced store.
 */
import { authenticate } from "../shopify.server";
import { getStore, toStoreView } from "./store.server";

/**
 * Authenticates the request and loads the store. Redirects to the welcome
 * screen when the store hasn't been synced yet.
 */
export async function requireStore(request) {
  const context = await authenticate.admin(request);
  const store = toStoreView(await getStore(context.session.shop));
  if (!store?.syncedAt) throw context.redirect("/app");
  return { ...context, shop: context.session.shop, store };
}

/** Reads an action's form data or JSON body. */
export async function readBody(request) {
  const type = request.headers.get("content-type") || "";
  if (type.includes("application/json")) return request.json();
  return Object.fromEntries(await request.formData());
}

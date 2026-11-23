import { authenticate } from "../shopify.server";
import {
  refreshCollection,
  refreshProduct,
  removeCollection,
  removeProduct,
} from "../services/catalog.server";
import { submitChanged } from "../services/indexnow.server";
import { markCatalogChanged } from "../services/llms.server";
import { getStore } from "../services/store.server";

const gidFor = (type, payload) =>
  payload.admin_graphql_api_id ?? `gid://shopify/${type}/${payload.id}`;

/**
 * products/* and collections/* webhooks: keep synced rows current and
 * schedule an llms.txt refresh. Responds quickly; Shopify retries on failure.
 */
export const action = async ({ request }) => {
  const { shop, topic, admin, payload } = await authenticate.webhook(request);

  // Nothing to update before the first sync, or after uninstall (no admin session).
  const store = admin ? await getStore(shop) : null;
  if (!store) return new Response();
  const pageUrl = (path) =>
    payload.handle && store.url ? `${store.url}/${path}/${payload.handle}` : null;

  switch (topic) {
    case "PRODUCTS_CREATE":
    case "PRODUCTS_UPDATE":
      await refreshProduct(admin, shop, gidFor("Product", payload));
      if (payload.status === "active" && payload.published_at)
        await submitChanged(shop, pageUrl("products"), "Product updated in Shopify");
      break;
    case "PRODUCTS_DELETE":
      await removeProduct(shop, gidFor("Product", payload));
      break;
    case "COLLECTIONS_CREATE":
    case "COLLECTIONS_UPDATE":
      await refreshCollection(admin, shop, gidFor("Collection", payload));
      await submitChanged(shop, pageUrl("collections"), "Collection updated in Shopify");
      break;
    case "COLLECTIONS_DELETE":
      await removeCollection(shop, gidFor("Collection", payload));
      break;
    default:
      return new Response();
  }

  await markCatalogChanged(shop);
  return new Response();
};

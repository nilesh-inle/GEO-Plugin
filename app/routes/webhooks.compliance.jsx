import { authenticate } from "../shopify.server";
import { deleteShopData } from "../services/store.server";

/**
 * Mandatory compliance webhooks.
 * GEO stores no customer data, so customer requests need no action.
 * shop/redact (48 hours after uninstall) deletes everything stored for the shop.
 */
export const action = async ({ request }) => {
  const { shop, topic } = await authenticate.webhook(request);

  if (topic === "SHOP_REDACT") {
    await deleteShopData(shop);
  }

  return new Response();
};

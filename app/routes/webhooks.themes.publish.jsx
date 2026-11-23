import { authenticate } from "../shopify.server";
import { reapplyManagedTemplates } from "../services/fixes.server";

/**
 * themes/publish: robots.txt.liquid and llms.txt.liquid live in the theme,
 * so copy them to the newly published theme. Runs after responding, so
 * Shopify's webhook timeout isn't affected by theme writes.
 */
export const action = async ({ request }) => {
  const { shop, admin, payload } = await authenticate.webhook(request);
  if (!admin) return new Response();

  const themeId =
    payload.admin_graphql_api_id ??
    `gid://shopify/OnlineStoreTheme/${payload.id}`;
  reapplyManagedTemplates(admin, shop, themeId).catch((error) =>
    console.error(
      `[geo] re-applying templates on theme publish failed for ${shop}`,
      error,
    ),
  );

  return new Response();
};

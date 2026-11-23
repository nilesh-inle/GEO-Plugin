import { authenticate } from "../shopify.server";
import { getStore, toStoreView } from "../services/store.server";

/**
 * IndexNow key file, served on the store's domain through the app proxy:
 * https://<store>/apps/geo/indexnow/<key>.txt
 */
export const loader = async ({ request, params }) => {
  const { session } = await authenticate.public.appProxy(request);
  if (!session) return new Response("Not found", { status: 404 });
  const store = toStoreView(await getStore(session.shop));
  const key = store?.settings?.indexNowKey;
  if (!key || params.file !== `${key}.txt`)
    return new Response("Not found", { status: 404 });
  return new Response(key, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
};

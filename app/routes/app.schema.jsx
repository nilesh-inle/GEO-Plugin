import { authenticate } from "../shopify.server";

/** Moved into the AI access hub. */
export const loader = async ({ request }) => {
  const { redirect } = await authenticate.admin(request);
  const product = new URL(request.url).searchParams.get("product");
  throw redirect(
    product ? `/app/access/schema?product=${encodeURIComponent(product)}` : "/app/access/schema",
  );
};

import { authenticate } from "../shopify.server";

/** Moved to /app/access/brand. Keeps old links and bookmarks working. */
export const loader = async ({ request }) => {
  const { redirect } = await authenticate.admin(request);
  const { search } = new URL(request.url);
  throw redirect(`/app/access/brand${search}`);
};

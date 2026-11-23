import { authenticate } from "../shopify.server";

/** Moved to /app/settings/tools. Keeps old links and bookmarks working. */
export const loader = async ({ request }) => {
  const { redirect } = await authenticate.admin(request);
  const { search } = new URL(request.url);
  throw redirect(`/app/settings/tools${search}`);
};

import { authenticate } from "../shopify.server";

/** Moved into the AI visibility hub. */
export const loader = async ({ request }) => {
  const { redirect } = await authenticate.admin(request);
  const tool = new URL(request.url).searchParams.get("tool");
  throw redirect(tool ? `/app/visibility?tool=${encodeURIComponent(tool)}` : "/app/visibility");
};

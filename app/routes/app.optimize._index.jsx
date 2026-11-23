import { authenticate } from "../shopify.server";
import { getLatestRun } from "../services/sync.server";
import { RUN_STATUS } from "../lib/constants";

/** The old Optimize dashboard. Its parts now live on Overview and the Fix list. */
export const loader = async ({ request }) => {
  const { session, redirect } = await authenticate.admin(request);
  const run = await getLatestRun(session.shop);
  if (run?.status === RUN_STATUS.RUNNING && run.mode !== "verify")
    throw redirect("/app/optimize/sync");
  throw redirect("/app");
};

import { authenticate } from "../shopify.server";
import db from "../db.server";

export const action = async ({ request }) => {
  const { shop, session, topic } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  // Webhook requests can trigger multiple times and after an app has already been uninstalled.
  // If this webhook already ran, the session may have been deleted previously.
  if (session) {
    await db.session.deleteMany({ where: { shop } });
  }

  // Merchants' AI API keys aren't kept after uninstall. Everything else is
  // deleted by shop/redact (webhooks.compliance.jsx).
  await db.aiTool.deleteMany({ where: { shop } });
  await db.store.updateMany({
    where: { shop },
    data: { trackNextRunAt: null },
  });

  return new Response();
};

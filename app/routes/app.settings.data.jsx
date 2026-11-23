import { useFetcher, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import prisma from "../db.server";
import { readBody, requireStore } from "../services/guard.server";
import { removeGeoFiles } from "../services/fixes.server";
import { SettingsNav } from "../components/HubNav";
import { Metric, MetricGrid } from "../components/ui";
import { formatNumber } from "../lib/format";

const SCOPES = [
  ["read_products", "Audit products and collections"],
  ["write_products", "Publish product drafts you approve"],
  ["read_legal_policies", "Read policies for llms.txt, schema and checks"],
  ["read_themes", "Read robots.txt and llms.txt templates; check the app embed"],
  ["write_themes", "Apply robots.txt and llms.txt changes you approve"],
  ["read_orders", "AI performance: orders that came from AI assistants"],
  ["read_content", "Content: score blog posts and pages"],
  ["write_app_proxy", "Serve the IndexNow key file on your store's domain"],
  [
    "write_online_store_navigation",
    "Add one URL redirect so the IndexNow key file is found at your store root",
  ],
];

export const action = async ({ request }) => {
  const { admin, shop } = await requireStore(request);
  const body = await readBody(request);
  if (body.intent !== "removeFiles") return { ok: false };
  const result = await removeGeoFiles(admin, shop);
  return { ok: !result.failed.length, ...result };
};

export const loader = async ({ request }) => {
  const { session, shop, store } = await requireStore(request);
  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);
  const [answers, drafts, changes, products] = await Promise.all([
    prisma.trackAnswer.count({ where: { shop, createdAt: { gte: monthStart } } }),
    prisma.productDraft.count({ where: { shop, createdAt: { gte: monthStart } } }),
    prisma.changeLog.count({ where: { shop } }),
    prisma.product.count({ where: { shop, status: "ACTIVE" } }),
  ]);
  const granted = String(session.scope || "").split(",").map((scope) => scope.trim());
  return {
    usage: { answers, drafts, changes, products, competitors: store.competitors.length },
    scopes: SCOPES.map(([scope, usedFor]) => ({
      scope,
      usedFor,
      granted:
        granted.includes(scope) ||
        (scope.startsWith("read_") && granted.includes(scope.replace("read_", "write_"))),
    })),
  };
};

export default function DataSettings() {
  const { usage, scopes } = useLoaderData();
  const remove = useFetcher();
  const removing = remove.state !== "idle";
  const outcome = remove.data;
  return (
    <s-page heading="Settings">
      <s-stack direction="block" gap="base">
        <SettingsNav current="data" />

        {outcome?.failed?.length > 0 && (
          <s-banner tone="critical" heading="Some files weren't removed">
            {outcome.failed.map((item) => `${item.area}: ${item.message}`).join(" · ")}
          </s-banner>
        )}
        {outcome && !outcome.failed?.length && (
          <s-banner tone="success" heading="GEO files removed">
            {outcome.removed.length
              ? "Your theme is back to how it was before GEO changed it."
              : "GEO hasn't changed any theme files, so there was nothing to remove."}
          </s-banner>
        )}

        <s-section heading="Usage this month">
          <MetricGrid min={160}>
            <Metric label="AI answers checked" value={formatNumber(usage.answers)} help="Billed by your AI tools, not GEO" />
            <Metric label="Product drafts" value={formatNumber(usage.drafts)} />
            <Metric label="Products audited" value={formatNumber(usage.products)} />
            <Metric label="Competitors watched" value={formatNumber(usage.competitors)} />
          </MetricGrid>
        </s-section>

        <s-section heading="Permissions">
          <s-table>
            <s-table-header-row>
              <s-table-header listSlot="primary">Access</s-table-header>
              <s-table-header>Used for</s-table-header>
              <s-table-header>Status</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {scopes.map((item) => (
                <s-table-row key={item.scope}>
                  <s-table-cell>{item.scope}</s-table-cell>
                  <s-table-cell>{item.usedFor}</s-table-cell>
                  <s-table-cell>
                    <s-badge tone={item.granted ? "success" : "warning"}>
                      {item.granted ? "Granted" : "Not granted yet"}
                    </s-badge>
                  </s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        </s-section>

        <s-section heading="Your data">
          <s-unordered-list>
            <s-list-item>
              GEO stores a copy of product and collection details, audit
              results, tracked AI answers and the original values of every
              change it publishes, so you can restore them.
            </s-list-item>
            <s-list-item>
              API keys for your AI tools are encrypted and never shown again.
            </s-list-item>
            <s-list-item>
              Orders are read on demand for AI performance and aren&apos;t
              stored. Customer details are never read.
            </s-list-item>
            <s-list-item>
              {`Everything is deleted when Shopify sends the data-removal request after you uninstall. ${formatNumber(usage.changes)} changes are in your history today.`}
            </s-list-item>
          </s-unordered-list>
        </s-section>

        <s-section heading="Before you uninstall">
          <s-stack direction="block" gap="base">
            <s-text color="subdued">
              Shopify removes the app&apos;s access when you uninstall it, so
              GEO can&apos;t clean up afterwards. The robots.txt and llms.txt
              templates it added stay in your theme unless you remove them
              first. The schema app embed is removed by Shopify automatically.
            </s-text>
            <s-stack direction="inline">
              <s-button
                tone="critical"
                loading={removing || undefined}
                commandFor="remove-geo-files"
                command="--show"
              >
                Remove GEO files from my theme
              </s-button>
            </s-stack>
          </s-stack>
          <s-modal id="remove-geo-files" heading="Remove GEO files?">
            <s-text>
              GEO puts robots.txt, llms.txt and the schema settings back to how
              they were before its first change. Anything you edited in those
              files yourself afterwards is replaced.
            </s-text>
            <s-button
              slot="primary-action"
              variant="primary"
              tone="critical"
              commandFor="remove-geo-files"
              command="--hide"
              onClick={() =>
                remove.submit({ intent: "removeFiles" }, { method: "post" })
              }
            >
              Remove files
            </s-button>
            <s-button
              slot="secondary-actions"
              commandFor="remove-geo-files"
              command="--hide"
            >
              Cancel
            </s-button>
          </s-modal>
        </s-section>
      </s-stack>
    </s-page>
  );
}

export const headers = (headersArgs) => boundary.headers(headersArgs);

import { useFetcher, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { readBody, requireStore } from "../services/guard.server";
import { checkSitemap } from "../services/access.server";
import {
  catalogUrls,
  ensureKey,
  ensureKeyRedirect,
  keyLocation,
  submitUrls,
  verifyKeyFile,
} from "../services/indexnow.server";
import { patchStoreJson } from "../services/store.server";
import { AccessNav } from "../components/HubNav";
import { EvidenceBadge, Metric, MetricGrid } from "../components/ui";
import { formatDateTime } from "../lib/format";

export const loader = async ({ request }) => {
  const { store } = await requireStore(request);
  const key = store.settings.indexNowKey ?? null;
  const [sitemap, keyFile] = await Promise.all([
    checkSitemap(store),
    key ? verifyKeyFile(store, key) : null,
  ]);
  return {
    sitemap,
    key,
    keyUrl: key ? keyLocation(store, key) : null,
    keyFile,
    auto: Boolean(store.settings.indexNow),
    log: store.settings.indexNowLog ?? [],
  };
};

export const action = async ({ request }) => {
  const { shop, admin } = await requireStore(request);
  const body = await readBody(request);
  try {
    if (body.intent === "setup") {
      const redirect = await ensureKeyRedirect(admin, await ensureKey(shop));
      return {
        ok: redirect.ok,
        error: redirect.needsScope
          ? "GEO needs permission to add a URL redirect for the key file. Approve the updated app permissions, then set up IndexNow again."
          : redirect.error,
      };
    }
    if (body.intent === "auto") {
      const key = await ensureKey(shop);
      if (body.value === "true") {
        const redirect = await ensureKeyRedirect(admin, key);
        if (!redirect.ok)
          return {
            ok: false,
            error: redirect.needsScope
              ? "GEO needs permission to add a URL redirect for the key file. Approve the updated app permissions, then try again."
              : redirect.error,
          };
      }
      await patchStoreJson(shop, "settings", { indexNow: body.value === "true" });
      return { ok: true };
    }
    if (body.intent === "submitAll") {
      const result = await submitUrls(shop, await catalogUrls(shop), { trigger: "Full catalog, by you" });
      return { ok: !result.error, ...result };
    }
  } catch (error) {
    return { ok: false, error: error.message };
  }
  return null;
};

const kindLabel = { products: "products", collections: "collections", pages: "pages", blogs: "blogs" };

export default function IndexingPage() {
  const data = useLoaderData();
  const act = useFetcher();
  const busy = (intent) => act.state !== "idle" && act.formData?.get("intent") === intent;
  const last = data.log[0];
  const sitemapParts = Object.entries(data.sitemap.kinds)
    .map(([kind, count]) => `${count} ${kindLabel[kind] ?? kind} file${count === 1 ? "" : "s"}`)
    .join(", ");

  return (
    <s-page heading="AI access" inlineSize="large">
      <s-button
        slot="primary-action"
        variant="primary"
        disabled={!data.keyFile?.ok || undefined}
        loading={busy("submitAll") || undefined}
        onClick={() => act.submit({ intent: "submitAll" }, { method: "post" })}
      >
        Submit all pages now
      </s-button>

      <s-stack direction="block" gap="base">
        <AccessNav current="indexing" />

        {act.data?.error && (
          <s-banner tone="critical" heading="IndexNow didn't accept the request">
            {act.data.error}
          </s-banner>
        )}
        {act.data?.submitted > 0 && (
          <s-banner tone="success" heading={`${act.data.submitted} URLs submitted`}>
            {`IndexNow answered HTTP ${act.data.status}.`}
          </s-banner>
        )}

        <MetricGrid>
          <Metric
            label="Sitemap"
            value={data.sitemap.ok ? `HTTP ${data.sitemap.status}` : "Unreachable"}
            help={data.sitemap.ok ? sitemapParts || "Served by Shopify" : "/sitemap.xml"}
          />
          <Metric
            label="IndexNow key file"
            value={!data.key ? "Not set up" : data.keyFile?.ok ? "Served" : "Not reachable"}
            help={data.key ? "At your store root, through the app proxy" : "One click to set up"}
          />
          <Metric
            label="Automatic submits"
            value={data.auto ? "On" : "Off"}
            help="When products or collections change"
          />
          <Metric
            label="Last submission"
            value={last ? (last.error ? "Failed" : `${last.urls} URLs`) : "None yet"}
            help={last ? formatDateTime(last.at) : "Bing, Yandex, Naver, Seznam, Yep"}
          />
        </MetricGrid>

        <s-section heading="IndexNow">
          <s-stack direction="block" gap="base">
            <s-stack direction="inline" gap="small" alignItems="center">
              <EvidenceBadge evidence="documented" />
              <s-text color="subdued">
                Tells Bing, which powers Copilot, plus Yandex, Naver, Seznam and
                Yep that a page changed, so they recrawl it sooner. Google
                doesn&apos;t use IndexNow; it reads your sitemap.
              </s-text>
            </s-stack>

            {!data.key ? (
              <s-stack direction="inline">
                <s-button
                  loading={busy("setup") || undefined}
                  onClick={() => act.submit({ intent: "setup" }, { method: "post" })}
                >
                  Set up IndexNow
                </s-button>
              </s-stack>
            ) : (
              <s-stack direction="block" gap="small">
                <s-stack direction="inline" gap="small" alignItems="center">
                  <s-badge tone={data.keyFile?.ok ? "success" : "warning"}>
                    {data.keyFile?.ok ? "Key verified" : `Key file returned HTTP ${data.keyFile?.status || "error"}`}
                  </s-badge>
                  <s-link href={data.keyUrl} target="_blank">
                    {data.keyUrl}
                  </s-link>
                </s-stack>
                {!data.keyFile?.ok && (
                  <s-stack direction="inline">
                    <s-button
                      loading={busy("setup") || undefined}
                      onClick={() => act.submit({ intent: "setup" }, { method: "post" })}
                    >
                      Fix key file
                    </s-button>
                  </s-stack>
                )}
                {!data.keyFile?.ok && (
                  <s-text color="subdued">
                    The key lives at your store&apos;s root and redirects to
                    the app proxy (/apps/geo). If it isn&apos;t reachable, run
                    setup again, then check that the app proxy is configured
                    for this app and the store is public.
                  </s-text>
                )}
                <s-stack direction="inline" gap="small" alignItems="center">
                  <s-button
                    variant={data.auto ? "secondary" : "primary"}
                    loading={busy("auto") || undefined}
                    onClick={() =>
                      act.submit({ intent: "auto", value: String(!data.auto) }, { method: "post" })
                    }
                  >
                    {data.auto ? "Turn off automatic submits" : "Submit automatically"}
                  </s-button>
                  <s-text color="subdued">
                    Each URL is sent at most once every 10 minutes.
                  </s-text>
                </s-stack>
              </s-stack>
            )}

            {data.log.length > 0 && (
              <s-table>
                <s-table-header-row>
                  <s-table-header listSlot="primary">Time</s-table-header>
                  <s-table-header>Trigger</s-table-header>
                  <s-table-header format="numeric">URLs</s-table-header>
                  <s-table-header>Response</s-table-header>
                </s-table-header-row>
                <s-table-body>
                  {data.log.map((entry) => (
                    <s-table-row key={entry.at}>
                      <s-table-cell>{formatDateTime(entry.at)}</s-table-cell>
                      <s-table-cell>{entry.trigger}</s-table-cell>
                      <s-table-cell>{entry.urls}</s-table-cell>
                      <s-table-cell>
                        <s-badge tone={entry.error ? "critical" : "success"}>
                          {entry.error ? `HTTP ${entry.status || "error"}` : `HTTP ${entry.status} accepted`}
                        </s-badge>
                      </s-table-cell>
                    </s-table-row>
                  ))}
                </s-table-body>
              </s-table>
            )}
          </s-stack>
        </s-section>

        <s-section heading="Sitemap">
          <s-stack direction="block" gap="small">
            <s-stack direction="inline" gap="small" alignItems="center">
              <s-badge tone={data.sitemap.ok ? "success" : "critical"}>
                {data.sitemap.ok ? `HTTP ${data.sitemap.status}` : "Unreachable"}
              </s-badge>
              <s-link href={data.sitemap.url} target="_blank">
                /sitemap.xml
              </s-link>
            </s-stack>
            <s-text color="subdued">
              {data.sitemap.ok
                ? `Served by Shopify with ${data.sitemap.children} sitemap files${sitemapParts ? ` (${sitemapParts})` : ""}. Shopify keeps it current; it's listed in robots.txt.`
                : "Crawlers can't read your sitemap. Check that the store is public."}
            </s-text>
          </s-stack>
        </s-section>

        <s-section heading="Search Console and Bing Webmaster Tools">
          <s-paragraph>
            Index coverage and Copilot citation data live in Google Search
            Console and Bing Webmaster Tools. GEO doesn&apos;t connect to them
            yet; open them to see which pages are indexed.
          </s-paragraph>
          <s-stack direction="inline" gap="small">
            <s-button href="https://search.google.com/search-console" target="_blank">
              Search Console
            </s-button>
            <s-button href="https://www.bing.com/webmasters" target="_blank">
              Bing Webmaster Tools
            </s-button>
          </s-stack>
        </s-section>
      </s-stack>
    </s-page>
  );
}

export const headers = (headersArgs) => boundary.headers(headersArgs);

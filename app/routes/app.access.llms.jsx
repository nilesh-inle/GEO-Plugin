import { useRef } from "react";
import {
  useFetcher,
  useLoaderData,
  useNavigation,
  useSubmit,
  useActionData,
} from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { getManualTemplates, publishLlms } from "../services/fixes.server";
import { buildStoreLlms } from "../services/llms.server";
import { getStore, toStoreView, updateStore } from "../services/store.server";
import {
  fetchStorefront,
  withCacheBuster,
} from "../services/storefront.server";
import { getMainTheme, readThemeFiles } from "../services/theme.server";
import { CodeBlock } from "../components/CodeBlock";
import { AccessNav } from "../components/HubNav";
import { ManualTemplates } from "../components/ManualTemplates";
import { FIX_STATUS, THEME_FILES } from "../lib/constants";
import { formatDateTime, pluralize } from "../lib/format";
import { isManagedLlmsTemplate } from "../lib/llms";

export const loader = async ({ request }) => {
  const { admin, session, redirect } = await authenticate.admin(request);
  const { shop } = session;
  const storeRow = await getStore(shop);
  if (!storeRow?.syncedAt) throw redirect("/app");
  const store = toStoreView(storeRow);

  const theme = await getMainTheme(admin);
  const url = `${store.url}/llms.txt`;
  const [llms, files, live] = await Promise.all([
    buildStoreLlms(shop),
    readThemeFiles(admin, theme.id, [THEME_FILES.llms]),
    fetchStorefront(withCacheBuster(url)),
  ]);
  const template = files[THEME_FILES.llms];
  const finalPath = live.ok ? new URL(live.finalUrl).pathname : null;

  return {
    url,
    markdown: llms.markdown,
    stats: llms.stats,
    status: store.llmsStatus,
    message: store.fixState.llms?.message ?? null,
    autoUpdate: store.llmsAutoUpdate,
    updatedAt: store.llmsUpdatedAt,
    themeName: theme.name,
    template: {
      exists: template != null,
      managed: isManagedLlmsTemplate(template),
    },
    live: {
      served: live.ok && finalPath === "/llms.txt",
      redirectedTo: live.ok && finalPath !== "/llms.txt" ? finalPath : null,
    },
    manual: getManualTemplates(store, shop).filter(
      (item) => item.area === "llms",
    ),
  };
};

export const action = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const form = Object.fromEntries(await request.formData());

  if (form.intent === "autoUpdate") {
    await updateStore(session.shop, {
      llmsAutoUpdate: form.enabled === "true",
    });
    return { intent: form.intent, ok: true };
  }

  const result = await publishLlms(admin, session.shop);
  return {
    intent: "publish",
    ok: result.status === FIX_STATUS.APPLIED,
    error: result.status === FIX_STATUS.FAILED ? result.message : null,
  };
};

export default function LlmsPage() {
  const data = useLoaderData();
  const actionData = useActionData();
  const submit = useSubmit();
  const publishing = useNavigation().state !== "idle";
  const published = data.status === FIX_STATUS.APPLIED;

  return (
    <s-page heading="AI access" inlineSize="large">
      <s-button
        slot="primary-action"
        variant="primary"
        onClick={() => submit({ intent: "publish" }, { method: "post" })}
        loading={publishing || undefined}
      >
        {published ? "Update now" : "Publish llms.txt"}
      </s-button>
      <s-button slot="secondary-actions" href={data.url} target="_blank">
        Open llms.txt
      </s-button>

      <s-stack direction="block" gap="base">
        <AccessNav current="llms" />
        <s-stack direction="inline" gap="small" alignItems="center">
          <s-heading>llms.txt</s-heading>
          <s-badge tone="neutral" icon="info">
            Experimental
          </s-badge>
        </s-stack>
        <s-paragraph>
          llms.txt is a short guide to your store written for AI: what you sell,
          your main collections and products, and your policies. GEO builds it
          from your catalog and serves it at /llms.txt.
        </s-paragraph>

        {actionData?.error && (
          <s-banner tone="critical" heading="llms.txt wasn't published">
            {actionData.error}
          </s-banner>
        )}
        <ManualTemplates templates={data.manual} />
        <StatusBanner data={data} />

        <s-section heading="What AI reads">
          <s-stack direction="block" gap="small">
            <s-text color="subdued">
              {`${pluralize(data.stats.collections, "collection")}, ${pluralize(data.stats.products, "top product")} and ${pluralize(data.stats.policies, "policy", "policies")}, built from your synced catalog.`}
            </s-text>
            <CodeBlock text={data.markdown} maxHeight="560px" />
          </s-stack>
        </s-section>

        <AutoUpdate enabled={data.autoUpdate} updatedAt={data.updatedAt} />
      </s-stack>
    </s-page>
  );
}

function StatusBanner({ data }) {
  if (data.status === FIX_STATUS.FAILED) {
    return (
      <s-banner tone="critical" heading="The last publish failed">
        {data.message}
      </s-banner>
    );
  }
  if (data.status === FIX_STATUS.MANUAL) return null;
  if (data.status !== FIX_STATUS.APPLIED) {
    return (
      <s-banner tone="info" heading="Not published yet">
        {`Publishing adds templates/llms.txt.liquid to your live theme (${data.themeName}).`}
      </s-banner>
    );
  }
  if (data.live.served) {
    return <s-banner tone="success" heading="llms.txt is live on your store" />;
  }
  if (data.live.redirectedTo?.startsWith("/password")) {
    return (
      <s-banner
        tone="warning"
        heading="Published, but hidden by your store password"
      >
        Visitors and AI tools see the password page instead of llms.txt until
        the store is open.
      </s-banner>
    );
  }
  return (
    <s-banner
      tone="warning"
      heading="Published, but /llms.txt isn't answering yet"
    >
      {data.template.managed
        ? "Shopify can take a minute to serve a new template. Refresh this page shortly."
        : "The theme's llms.txt template was changed outside GEO. Update now to restore it."}
    </s-banner>
  );
}

function AutoUpdate({ enabled, updatedAt }) {
  const fetcher = useFetcher();
  const switchRef = useRef(null);

  return (
    <s-section heading="Keep it up to date">
      <s-stack direction="block" gap="small">
        <s-switch
          ref={switchRef}
          name="autoUpdate"
          label="Update llms.txt when products or collections change"
          checked={enabled || undefined}
        />
        <s-text color="subdued">{`Last updated ${formatDateTime(updatedAt)}`}</s-text>
        <s-stack direction="inline">
          <s-button
            onClick={() =>
              fetcher.submit(
                {
                  intent: "autoUpdate",
                  enabled: String(Boolean(switchRef.current?.checked)),
                },
                { method: "post" },
              )
            }
            loading={fetcher.state !== "idle" || undefined}
          >
            Save
          </s-button>
        </s-stack>
      </s-stack>
    </s-section>
  );
}

export const headers = (headersArgs) => boundary.headers(headersArgs);

import { useRef } from "react";
import { useFetcher, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import prisma from "../db.server";
import { readBody, requireStore } from "../services/guard.server";
import { saveSnippetRules } from "../services/fixes.server";
import { getLatestAudit } from "../services/sync.server";
import {
  getAppEmbedStatus,
  getEmbedActivationUrl,
  getMainTheme,
} from "../services/theme.server";
import { AccessNav } from "../components/HubNav";
import {
  SNIPPET_OPTIONS,
  SNIPPET_PAGE_TYPES,
  normalizeSnippetRules,
} from "../lib/schemaSettings";

const SHOPPING_SURFACES = [
  {
    name: "ChatGPT",
    through: "Shopify Catalog (agentic storefronts)",
    checkout: "On your store or in ChatGPT",
  },
  {
    name: "Microsoft Copilot",
    through: "Shopify Catalog (agentic storefronts)",
    checkout: "In Copilot",
  },
  {
    name: "Google AI Mode and Gemini",
    through: "Shopify Catalog and Google Merchant Center",
    checkout: "In Google, where available",
  },
  {
    name: "Perplexity",
    through: "Perplexity's merchant program",
    checkout: "In Perplexity",
  },
];

const TRAINING = ["Google-Extended", "GPTBot", "Applebot-Extended", "ClaudeBot"];

export const loader = async ({ request }) => {
  const { admin, shop, store } = await requireStore(request);
  const theme = await getMainTheme(admin);
  const [embedEnabled, audit, products, hiddenProducts, collections] =
    await Promise.all([
      getAppEmbedStatus(admin, theme.id),
      getLatestAudit(shop),
      prisma.product.count({ where: { shop, status: "ACTIVE" } }),
      prisma.product.count({ where: { shop, isGiftCard: true } }),
      prisma.collection.count({ where: { shop } }),
    ]);
  const crawlers = audit?.robots?.crawlers ?? [];
  return {
    embedEnabled,
    activationUrl: getEmbedActivationUrl(shop),
    themeName: theme.name,
    rules: normalizeSnippetRules(store.settings?.snippets),
    counts: { product: products, collection: collections },
    hiddenProducts,
    training: TRAINING.map((agent) => {
      const crawler = crawlers.find((item) => item.agent === agent);
      return {
        agent,
        usedFor: crawler?.usedFor ?? "",
        allowed: crawler ? crawler.allowed : null,
      };
    }),
  };
};

export const action = async ({ request }) => {
  const { admin, shop } = await requireStore(request);
  const body = await readBody(request);
  try {
    const rules = await saveSnippetRules(admin, shop, body.rules ?? {});
    return { ok: true, rules };
  } catch (error) {
    return { ok: false, error: error.message };
  }
};

export default function SurfacesPage() {
  const data = useLoaderData();
  const save = useFetcher();
  const formRef = useRef(null);

  const submit = () => {
    const rules = {};
    for (const select of formRef.current?.querySelectorAll("s-select[name]") ?? [])
      rules[select.getAttribute("name")] = select.value;
    save.submit({ rules }, { method: "post", encType: "application/json" });
  };

  return (
    <s-page heading="AI access" inlineSize="large">
      <s-button
        slot="primary-action"
        variant="primary"
        loading={save.state !== "idle" || undefined}
        onClick={submit}
      >
        Save snippet rules
      </s-button>
      <s-button slot="secondary-actions" href="shopify://admin/settings/apps">
        Open apps and sales channels
      </s-button>

      <s-stack direction="block" gap="base">
        <AccessNav current="surfaces" />
        <s-banner tone="info">
          Three kinds of AI surface, three kinds of control. Shopping agents get
          your products from Shopify Catalog and are switched on in Shopify. AI
          answers in search follow your page-level snippet rules. Model training
          follows the training-bot rules on the Crawlers tab.
        </s-banner>

        {save.data?.ok && (
          <s-banner tone="success" heading="Snippet rules saved">
            {data.embedEnabled
              ? "They apply from the next time each page is crawled."
              : "Switch on the GEO app embed so your theme outputs them."}
          </s-banner>
        )}
        {save.data?.error && (
          <s-banner tone="critical" heading="Rules weren't saved">
            {save.data.error}
          </s-banner>
        )}

        <s-section heading="Shopping agents">
          <s-stack direction="block" gap="small">
            <s-paragraph>
              Products reach these through Shopify. Apps can&apos;t read or flip
              these switches, so each one is managed in your Shopify admin.
            </s-paragraph>
            <s-table>
              <s-table-header-row>
                <s-table-header listSlot="primary">Surface</s-table-header>
                <s-table-header>Connected through</s-table-header>
                <s-table-header>Checkout</s-table-header>
                <s-table-header>Status</s-table-header>
              </s-table-header-row>
              <s-table-body>
                {SHOPPING_SURFACES.map((surface) => (
                  <s-table-row key={surface.name}>
                    <s-table-cell>{surface.name}</s-table-cell>
                    <s-table-cell>{surface.through}</s-table-cell>
                    <s-table-cell>{surface.checkout}</s-table-cell>
                    <s-table-cell>
                      <s-badge tone="neutral">Check in Shopify</s-badge>
                    </s-table-cell>
                  </s-table-row>
                ))}
              </s-table-body>
            </s-table>
            {data.hiddenProducts > 0 && (
              <s-text color="subdued">
                {`${data.hiddenProducts} gift cards aren't offered to AI channels. Product-level visibility is managed in Shopify.`}
              </s-text>
            )}
          </s-stack>
        </s-section>

        <s-section heading="AI answers in search">
          <s-stack direction="block" gap="base" ref={formRef}>
            <s-paragraph>
              How much of each page AI Overviews, AI Mode and Copilot may quote.
              Restricting snippets also shortens your regular search snippets.
            </s-paragraph>
            {!data.embedEnabled && (
              <s-banner tone="warning" heading="GEO app embed is off">
                {`Snippet rules are output by the GEO app embed in “${data.themeName}”. Switch it on for them to take effect.`}
                <s-button slot="secondary-actions" href={data.activationUrl} target="_blank">
                  Switch on
                </s-button>
              </s-banner>
            )}
            <s-table>
              <s-table-header-row>
                <s-table-header listSlot="primary">Page type</s-table-header>
                <s-table-header>AI answers may quote</s-table-header>
                <s-table-header format="numeric">Pages</s-table-header>
              </s-table-header-row>
              <s-table-body>
                {SNIPPET_PAGE_TYPES.map((type) => (
                  <s-table-row key={type.key}>
                    <s-table-cell>{type.label}</s-table-cell>
                    <s-table-cell>
                      <s-select
                        name={type.key}
                        label={`${type.label} quoting`}
                        labelAccessibilityVisibility="exclusive"
                        value={data.rules[type.key] ?? ""}
                      >
                        {SNIPPET_OPTIONS.map((option) => (
                          <s-option key={option.value} value={option.value}>
                            {option.label}
                          </s-option>
                        ))}
                      </s-select>
                    </s-table-cell>
                    <s-table-cell>
                      {data.counts[type.key] != null
                        ? data.counts[type.key].toLocaleString("en-US")
                        : "–"}
                    </s-table-cell>
                  </s-table-row>
                ))}
                <s-table-row>
                  <s-table-cell>Cart, checkout, account</s-table-cell>
                  <s-table-cell>Not crawlable under Shopify&apos;s default rules</s-table-cell>
                  <s-table-cell>–</s-table-cell>
                </s-table-row>
              </s-table-body>
            </s-table>
            <s-text color="subdued">
              Google applies nosnippet and max-snippet to AI Overviews and AI
              Mode. These rules don&apos;t stop an AI from naming your brand,
              only from quoting the page.
            </s-text>
          </s-stack>
        </s-section>

        <s-section heading="Model training and grounding">
          <s-stack direction="block" gap="small">
            {data.training.map((bot) => (
              <s-stack key={bot.agent} direction="inline" gap="small" alignItems="center">
                <s-badge tone={bot.allowed === false ? "neutral" : bot.allowed ? "success" : "neutral"}>
                  {bot.allowed == null ? "Unknown" : bot.allowed ? "Allowed" : "Blocked"}
                </s-badge>
                <s-text type="strong">{bot.agent}</s-text>
                <s-text color="subdued">{bot.usedFor}</s-text>
              </s-stack>
            ))}
            <s-link href="/app/access">Change on the Crawlers tab</s-link>
          </s-stack>
        </s-section>

        <s-section heading="What each control won't do">
          <s-unordered-list>
            <s-list-item>
              Blocking training bots doesn&apos;t remove you from AI answers.
            </s-list-item>
            <s-list-item>
              Snippet rules don&apos;t stop an AI from naming your brand, only
              from quoting the page.
            </s-list-item>
            <s-list-item>
              Hiding products from AI channels doesn&apos;t affect your online
              store.
            </s-list-item>
          </s-unordered-list>
        </s-section>
      </s-stack>
    </s-page>
  );
}

export const headers = (headersArgs) => boundary.headers(headersArgs);

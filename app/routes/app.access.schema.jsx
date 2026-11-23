import { useRef } from "react";
import {
  useActionData,
  useLoaderData,
  useNavigate,
  useNavigation,
  useRevalidator,
  useSubmit,
} from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { saveSchemaSettings } from "../services/fixes.server";
import { getSchemaOverview } from "../services/schema.server";
import { getStore } from "../services/store.server";
import { CodeBlock } from "../components/CodeBlock";
import { AccessNav } from "../components/HubNav";
import {
  SchemaSettingsFields,
  readSchemaSettings,
} from "../components/SchemaSettingsFields";
import { useElementEvent } from "../hooks/useElementEvent";
import { FIX_STATUS } from "../lib/constants";
import { formatNumber } from "../lib/format";

export const loader = async ({ request }) => {
  const { admin, session, redirect } = await authenticate.admin(request);
  const storeRow = await getStore(session.shop);
  if (!storeRow?.syncedAt) throw redirect("/app");

  return getSchemaOverview(
    admin,
    session.shop,
    storeRow,
    new URL(request.url).searchParams.get("product"),
  );
};

export const action = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const body = await request.json();
  const result = await saveSchemaSettings(
    admin,
    session.shop,
    body.schemaSettings,
  );
  return result.status === FIX_STATUS.APPLIED
    ? { ok: true }
    : { error: result.message };
};

export default function SchemaPage() {
  const data = useLoaderData();
  const actionData = useActionData();
  const submit = useSubmit();
  const navigate = useNavigate();
  const { revalidate, state: revalidating } = useRevalidator();
  const saving = useNavigation().state === "submitting";
  const formRef = useRef(null);
  const productRef = useRef(null);

  useElementEvent(productRef, "change", (event) =>
    navigate(`/app/access/schema?product=${encodeURIComponent(event.target.value)}`),
  );

  const save = () =>
    submit(
      { schemaSettings: readSchemaSettings(formRef.current) },
      { method: "post", encType: "application/json" },
    );
  const saved = data.status === FIX_STATUS.APPLIED;

  return (
    <s-page heading="AI access" inlineSize="large">
      <s-button
        slot="primary-action"
        variant="primary"
        onClick={save}
        loading={saving || undefined}
      >
        {saved ? "Save settings" : "Publish schema"}
      </s-button>

      <s-stack direction="block" gap="base">
        <AccessNav current="schema" />
        <s-heading>Schema markup</s-heading>
        <s-paragraph>
          Schema markup is structured data in each page&apos;s code. AI tools
          read it for exact prices, stock, shipping and returns. GEO adds it
          through an app embed, using live store data on every page view.
        </s-paragraph>

        {actionData?.error && (
          <s-banner tone="critical" heading="Settings weren't saved">
            {actionData.error}
          </s-banner>
        )}
        {actionData?.ok && (
          <s-banner tone="success" heading="Schema settings saved" />
        )}

        <s-section heading="Status">
          <s-stack direction="block" gap="small">
            <StatusRow
              ok={data.embed.enabled}
              unknown={data.embed.enabled === null}
              label={
                data.embed.enabled
                  ? `App embed is on in ${data.embed.themeName}`
                  : `App embed is off in ${data.embed.themeName}`
              }
            />
            <StatusRow
              ok={saved}
              label={
                saved
                  ? "Shipping and returns details are published"
                  : data.status === FIX_STATUS.FAILED
                    ? `Publishing failed: ${data.message}`
                    : "Shipping and returns details aren't published yet"
              }
            />
            {!data.embed.enabled && (
              <s-stack direction="inline" gap="small">
                <s-button
                  variant="primary"
                  href={data.embed.activationUrl}
                  target="_top"
                >
                  Turn on app embed
                </s-button>
                <s-button
                  onClick={revalidate}
                  loading={revalidating !== "idle" || undefined}
                >
                  Check again
                </s-button>
              </s-stack>
            )}
          </s-stack>
        </s-section>

        <s-section heading="What the markup includes">
          <Coverage data={data} />
        </s-section>

        <s-section heading="Preview">
          <s-stack direction="block" gap="base">
            {data.productJson ? (
              <>
                <s-select
                  ref={productRef}
                  name="product"
                  label="Product page"
                  value={data.productId}
                  details="What the app embed adds to this product's page. Prices follow the shopper's currency on your store."
                >
                  {data.choices.map((choice) => (
                    <s-option key={choice.id} value={choice.id}>
                      {choice.title}
                    </s-option>
                  ))}
                </s-select>
                <CodeBlock text={data.productJson} maxHeight="420px" />
              </>
            ) : (
              <s-text color="subdued">No published products to preview.</s-text>
            )}
            <s-stack direction="block" gap="small-200">
              <s-text type="strong">Home page</s-text>
              <CodeBlock text={data.organizationJson} maxHeight="260px" />
              <s-text color="subdued">
                Your logo is added too when it&apos;s set in Shopify&apos;s
                brand settings.
              </s-text>
            </s-stack>
          </s-stack>
        </s-section>

        <s-section heading="Shipping and returns">
          <s-query-container>
            <s-stack direction="block" gap="small" ref={formRef}>
              <s-text color="subdued">
                Added to every product. Check they match your store&apos;s
                policies.
              </s-text>
              <SchemaSettingsFields
                settings={data.settings}
                currency={data.currency}
              />
              <s-stack direction="inline">
                <s-button onClick={save} loading={saving || undefined}>
                  Save settings
                </s-button>
              </s-stack>
            </s-stack>
          </s-query-container>
        </s-section>
      </s-stack>
    </s-page>
  );
}

function StatusRow({ ok, unknown, label }) {
  return (
    <s-stack direction="inline" gap="small" alignItems="center">
      <s-icon
        type={ok ? "check-circle" : "alert-triangle"}
        tone={ok ? "success" : unknown ? "info" : "warning"}
      />
      <s-text>{label}</s-text>
    </s-stack>
  );
}

function Coverage({ data }) {
  const { total, withGtin, withRating, withBrand } = data.coverage;
  const of = (count) => `${formatNumber(count)} of ${formatNumber(total)}`;
  const rows = [
    ["Name, price and stock", of(total), "Live from your store"],
    [
      "Shipping details",
      data.shippingOn ? of(total) : "Off",
      "Your shipping settings below",
    ],
    [
      "Return policy",
      of(total),
      data.returnsOn ? "Your returns settings below" : "No returns",
    ],
    ["GTIN", of(withGtin), "Product barcodes"],
    ["Rating", of(withRating), "Your reviews app"],
    ["Brand", of(withBrand), "Product vendor"],
    ["Organization", "Home page", "Store details"],
  ];

  return (
    <s-table>
      <s-table-header-row>
        <s-table-header listSlot="primary">Field</s-table-header>
        <s-table-header>Products</s-table-header>
        <s-table-header>Comes from</s-table-header>
      </s-table-header-row>
      <s-table-body>
        {rows.map(([field, count, source]) => (
          <s-table-row key={field}>
            <s-table-cell>{field}</s-table-cell>
            <s-table-cell>{count}</s-table-cell>
            <s-table-cell>{source}</s-table-cell>
          </s-table-row>
        ))}
      </s-table-body>
    </s-table>
  );
}

export const headers = (headersArgs) => boundary.headers(headersArgs);

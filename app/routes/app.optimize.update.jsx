import { useRef } from "react";
import {
  useActionData,
  useLoaderData,
  useNavigation,
  useSubmit,
} from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { applyFixes, getFixPlan } from "../services/fixes.server";
import { getLatestRun } from "../services/sync.server";
import { StepTracker } from "../components/StepTracker";
import { CodeBlock } from "../components/CodeBlock";
import {
  SchemaSettingsFields,
  readSchemaSettings,
} from "../components/SchemaSettingsFields";
import { readFields } from "../lib/fields";
import { RUN_STATUS } from "../lib/constants";
import { formatNumber, gidToId, pluralize } from "../lib/format";

export const loader = async ({ request }) => {
  const { admin, session, redirect } = await authenticate.admin(request);
  const run = await getLatestRun(session.shop);
  if (run?.status === RUN_STATUS.RUNNING) throw redirect("/app/optimize/sync");

  const plan = await getFixPlan(admin, session.shop);
  if (!plan) throw redirect("/app");

  // The full robots.txt.liquid is only needed server-side.
  const robots = { ...plan.robots };
  delete robots.content;
  return { ...plan, robots };
};

export const action = async ({ request }) => {
  const { admin, session, redirect } = await authenticate.admin(request);
  const body = await request.json();
  try {
    await applyFixes(admin, session.shop, {
      areas: {
        robots: Boolean(body.robots),
        llms: Boolean(body.llms),
        schema: Boolean(body.schema),
      },
      schemaSettings: body.schemaSettings,
    });
  } catch (error) {
    return { error: error.message };
  }

  // A verification scan is now running, so this page can't show the outcome.
  // The Fix list reads failed and manual results from the saved store state.
  return redirect("/app/fixes");
};

export default function UpdatePage() {
  const { robots, llms, schema, store } = useLoaderData();
  const actionData = useActionData();
  const submit = useSubmit();
  const applying = useNavigation().state !== "idle";
  const formRef = useRef(null);

  const apply = () => {
    const { on } = readFields(formRef.current);
    submit(
      {
        robots: robots.needed && on("robots"),
        llms: on("llms"),
        schema: on("schema"),
        schemaSettings: readSchemaSettings(formRef.current),
      },
      { method: "post", encType: "application/json" },
    );
  };

  return (
    <s-page heading="Update your store for AI">
      <s-button
        slot="primary-action"
        variant="primary"
        onClick={apply}
        loading={applying || undefined}
      >
        Apply all
      </s-button>
      <s-button slot="secondary-actions" href="/app/optimize/audit">
        Back to audit
      </s-button>

      <s-query-container>
        <s-stack direction="block" gap="base" ref={formRef}>
          <StepTracker current={2} />

          {actionData?.error && (
            <s-banner tone="critical" heading="Changes weren't applied">
              {actionData.error}
            </s-banner>
          )}

          <s-grid
            gridTemplateColumns="@container (inline-size > 760px) 'repeat(2, minmax(0, 1fr))', 'minmax(0, 1fr)'"
            gap="base"
          >
            <RobotsCard robots={robots} />
            <LlmsCard llms={llms} />
          </s-grid>

          <SchemaCard schema={schema} currency={store.currency} />

          <s-text color="subdued">
            Every change is checked on your live store after it&apos;s applied.
            Anything Shopify won&apos;t let the app change is shown on the next
            screen with steps to finish it by hand.
          </s-text>
        </s-stack>
      </s-query-container>
    </s-page>
  );
}

function RobotsCard({ robots }) {
  if (!robots.needed) {
    return (
      <s-section heading="robots.txt">
        <s-stack direction="inline" gap="small" alignItems="center">
          <s-icon
            type={
              robots.status === "unknown" ? "alert-triangle" : "check-circle"
            }
            tone={robots.status === "unknown" ? "warning" : "success"}
          />
          <s-text>
            {robots.status === "unknown"
              ? "robots.txt couldn't be read. Re-scan to check it."
              : "All AI search crawlers can already read your store. No change needed."}
          </s-text>
        </s-stack>
      </s-section>
    );
  }

  const lines = [
    ...robots.removed.map((text) => ({ text, kind: "removed" })),
    ...robots.added.map((text) => ({ text, kind: "added" })),
    { text: "# Shopify's default rules kept", kind: "note" },
  ];

  return (
    <s-section heading="robots.txt">
      <s-stack direction="block" gap="small">
        <s-switch name="robots" label="Apply robots.txt update" checked />
        <CodeBlock lines={lines} />
        <s-text color="subdued">
          Lets {robots.blocked.join(", ")} read your store. Training crawlers
          stay as they are.
        </s-text>
      </s-stack>
    </s-section>
  );
}

function LlmsCard({ llms }) {
  const preview = llms.markdown.split("\n").slice(0, 9).join("\n");

  return (
    <s-section heading="llms.txt">
      <s-stack direction="block" gap="small">
        {llms.shopifyDefault && (
          <s-text color="subdued">
            Shopify already serves a default llms.txt that points AI agents to
            your store&apos;s agent file. Replacing it is optional, and Google
            says it doesn&apos;t use llms.txt. The summary below keeps a link
            to the agent file.
          </s-text>
        )}
        <s-switch
          name="llms"
          label={
            llms.needed
              ? "Publish llms.txt"
              : llms.managed
                ? "Regenerate llms.txt now"
                : "Replace Shopify's default llms.txt"
          }
          checked={llms.needed || undefined}
        />
        <CodeBlock text={`${preview}\n…`} maxHeight="170px" />
        <s-stack
          direction="inline"
          gap="small"
          alignItems="center"
          justifyContent="space-between"
        >
          <s-text color="subdued">
            {pluralize(llms.stats.collections, "collection")},{" "}
            {pluralize(llms.stats.products, "top product")},{" "}
            {pluralize(llms.stats.policies, "policy", "policies")}. Updates when
            your products change.
          </s-text>
          <s-button
            variant="tertiary"
            commandFor="llms-preview"
            command="--show"
          >
            Preview full file
          </s-button>
        </s-stack>
      </s-stack>

      <s-modal id="llms-preview" heading="llms.txt preview" size="large">
        <CodeBlock text={llms.markdown} />
        <s-button
          slot="secondary-actions"
          commandFor="llms-preview"
          command="--hide"
        >
          Close
        </s-button>
      </s-modal>
    </s-section>
  );
}

function SchemaCard({ schema, currency }) {
  const { settings } = schema;

  return (
    <s-section heading="Product schema">
      <s-stack direction="block" gap="base">
        <s-switch name="schema" label="Apply schema updates" checked />

        <s-stack direction="block" gap="small">
          {schema.items.map((item) => (
            <s-stack
              key={item.key}
              direction="inline"
              gap="small"
              alignItems="center"
            >
              <s-icon type="check-circle" tone="success" />
              <s-text>{item.text}</s-text>
            </s-stack>
          ))}
          {schema.gtinMissing > 0 && (
            <GtinRow
              count={schema.gtinMissing}
              examples={schema.gtinExamples}
            />
          )}
        </s-stack>

        {!schema.embedEnabled && (
          <s-banner tone="info">
            Schema is added by the GEO app embed. After applying, you&apos;ll
            turn it on in your theme with one click.
          </s-banner>
        )}
        {schema.duplicatePages > 0 && (
          <s-banner tone="warning">
            Your theme outputs its own Product schema too. Both copies stay, so
            AI may see two. Remove the theme&apos;s copy if its prices or stock
            are wrong.
          </s-banner>
        )}

        <s-divider />

        <s-stack direction="block" gap="small">
          <s-heading>Shipping and returns details</s-heading>
          <s-text color="subdued">
            Added to every product. Check they match your store&apos;s policies.
          </s-text>
          <SchemaSettingsFields settings={settings} currency={currency} />
        </s-stack>
      </s-stack>
    </s-section>
  );
}

function GtinRow({ count, examples }) {
  return (
    <s-stack direction="block" gap="small-300">
      <s-stack direction="inline" gap="small" alignItems="center">
        <s-icon type="alert-triangle" tone="warning" />
        <s-text>{`${formatNumber(count)} ${count === 1 ? "product needs" : "products need"} a GTIN (barcode) from you`}</s-text>
      </s-stack>
      <s-box paddingInlineStart="large-200">
        <s-stack direction="inline" gap="small-200">
          {examples.map((product) => (
            <s-link
              key={product.id}
              href={`shopify://admin/products/${gidToId(product.id)}`}
              target="_top"
            >
              {product.title}
            </s-link>
          ))}
          {count > examples.length && (
            <s-link href="shopify://admin/products" target="_top">
              {`and ${formatNumber(count - examples.length)} more`}
            </s-link>
          )}
        </s-stack>
      </s-box>
    </s-stack>
  );
}

export const headers = (headersArgs) => boundary.headers(headersArgs);

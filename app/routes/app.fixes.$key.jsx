import { useActionData, useLoaderData, useNavigation, useSubmit } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { readBody, requireStore } from "../services/guard.server";
import { getIssue, setIssueStatus } from "../services/issues.server";
import { applyArea } from "../services/fixes.server";
import { EvidenceBadge, ImpactBadge, adminProductUrl } from "../components/ui";
import { AREAS } from "../lib/issues";
import { FIX_STATUS } from "../lib/constants";
import { formatDateTime, pluralize } from "../lib/format";

export const loader = async ({ request, params }) => {
  const { shop } = await requireStore(request);
  const key = decodeURIComponent(params.key);
  const found = await getIssue(shop, key);
  return { key, ...(found ?? { issue: null }) };
};

export const action = async ({ request, params }) => {
  const { admin, shop } = await requireStore(request);
  const body = await readBody(request);
  const key = decodeURIComponent(params.key);

  if (body.intent === "dismiss" || body.intent === "reopen") {
    await setIssueStatus(shop, key, body.intent === "dismiss" ? "dismissed" : "open");
    return { ok: true };
  }
  if (body.intent === "apply") {
    const area = String(body.area);
    if (!["robots", "llms", "schema"].includes(area))
      return { ok: false, error: "This fix can't be applied by the app." };
    try {
      const results = await applyArea(admin, shop, area);
      const result = results[area];
      if (result?.status === FIX_STATUS.MANUAL)
        return {
          ok: false,
          manual: true,
          error: `${result.message} Open the ${area === "robots" ? "robots.txt" : "llms.txt"} tab in AI access for the template.`,
        };
      if (result?.status === FIX_STATUS.FAILED)
        return { ok: false, error: result.message };
      return { ok: true, applied: area };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  }
  return { ok: false };
};

const AREA_LINK = {
  robots: "/app/access",
  llms: "/app/access/llms",
  schema: "/app/access/schema",
};

export default function IssueDetail() {
  const { key, issue, dismissed, products, auditedAt } = useLoaderData();
  const result = useActionData();
  const submit = useSubmit();
  const navigation = useNavigation();
  const busy = (intent) =>
    navigation.state !== "idle" && navigation.formData?.get("intent") === intent;

  if (!issue) {
    return (
      <s-page heading="Issue resolved">
        <s-link slot="breadcrumb-actions" href="/app/fixes">
          Fix list
        </s-link>
        <s-section>
          <s-stack direction="block" gap="base">
            <s-paragraph>
              {result?.applied
                ? "The fix was applied. GEO is re-checking your store; the issue closes when the check confirms it."
                : `“${key}” isn't detected in the latest audit any more.`}
            </s-paragraph>
            <s-stack direction="inline" gap="small">
              <s-button variant="primary" href="/app/fixes">
                Back to Fix list
              </s-button>
            </s-stack>
          </s-stack>
        </s-section>
      </s-page>
    );
  }

  const apply = issue.action?.kind === "apply";

  return (
    <s-page heading={issue.title} inlineSize="large">
      <s-link slot="breadcrumb-actions" href="/app/fixes">
        Fix list
      </s-link>
      {apply ? (
        <s-button
          slot="primary-action"
          variant="primary"
          commandFor="apply-fix"
          command="--show"
          disabled={dismissed || undefined}
        >
          {issue.action.label}
        </s-button>
      ) : (
        issue.action && (
          <s-button
            slot="primary-action"
            variant="primary"
            href={issue.action.href}
          >
            {issue.action.label}
          </s-button>
        )
      )}
      <s-button
        slot="secondary-actions"
        loading={busy(dismissed ? "reopen" : "dismiss") || undefined}
        onClick={() =>
          submit(
            { intent: dismissed ? "reopen" : "dismiss" },
            { method: "post" },
          )
        }
      >
        {dismissed ? "Restore issue" : "Dismiss issue"}
      </s-button>

      <s-stack direction="block" gap="base">
        <s-stack direction="inline" gap="small" alignItems="center">
          <ImpactBadge impact={issue.impact} />
          <EvidenceBadge evidence={issue.evidence} />
          <s-badge tone={apply ? "success" : "neutral"}>{issue.fixType}</s-badge>
          {dismissed && <s-badge tone="neutral">Dismissed</s-badge>}
          <s-text color="subdued">
            {`${AREAS[issue.area]} · ${issue.affects}${auditedAt ? ` · audit ${formatDateTime(auditedAt)}` : ""}`}
          </s-text>
        </s-stack>

        {result?.applied && (
          <s-banner tone="success" heading="Fix applied">
            GEO is re-checking your store now. This issue closes when the check
            confirms the change.
          </s-banner>
        )}
        {result?.error && (
          <s-banner tone="critical" heading="The fix wasn't applied">
            {result.error}
            {result.manual && AREA_LINK[issue.action?.area] && (
              <s-button
                slot="secondary-actions"
                href={AREA_LINK[issue.action.area]}
              >
                Open template
              </s-button>
            )}
          </s-banner>
        )}

        <s-section heading="What's wrong">
          <s-paragraph>{issue.whatsWrong}</s-paragraph>
          {issue.items?.length > 0 && (
            <s-unordered-list>
              {issue.items.map((item) => (
                <s-list-item key={item.title}>
                  <s-text type="strong">{item.title}</s-text>
                  {item.detail ? ` · ${item.detail}` : ""}
                </s-list-item>
              ))}
            </s-unordered-list>
          )}
        </s-section>

        <s-section heading="Why it matters">
          <s-stack direction="block" gap="small">
            <s-paragraph>{issue.whyItMatters}</s-paragraph>
            {issue.sources.length > 0 && (
              <s-stack direction="inline" gap="small" alignItems="center">
                <EvidenceBadge evidence={issue.evidence} />
                {issue.sources.map((source) => (
                  <s-link key={source.url} href={source.url} target="_blank">
                    {source.label}
                  </s-link>
                ))}
              </s-stack>
            )}
          </s-stack>
        </s-section>

        {products.length > 0 && (
          <AffectedProducts products={products} total={issue.count} />
        )}

        <s-section heading="What will change">
          <s-stack direction="block" gap="small">
            <s-paragraph>{issue.fix}</s-paragraph>
            {apply && (
              <s-text color="subdued">
                The previous version is saved. You can restore it from AI
                visibility › Reports › Change history.
              </s-text>
            )}
          </s-stack>
        </s-section>

        <s-section heading="How we'll verify">
          <s-unordered-list>
            <s-list-item>
              <s-text type="strong">Now.</s-text>{" "}
              {apply
                ? "GEO re-checks your store right after the fix is applied."
                : "Re-run the audit after you've made the change in Shopify."}
            </s-list-item>
            <s-list-item>
              <s-text type="strong">Next tracking run.</s-text> AI visibility
              asks your tracked questions again.
            </s-list-item>
            <s-list-item>
              <s-text type="strong">30 days.</s-text> Reports compares before and
              after. Movement is a correlation, not proof.
            </s-list-item>
          </s-unordered-list>
        </s-section>
      </s-stack>

      {apply && (
        <s-modal id="apply-fix" heading={`${issue.action.label}?`}>
          <s-stack direction="block" gap="base">
            <s-paragraph>{issue.fix}</s-paragraph>
            <s-banner tone="info">
              The previous version is saved and can be restored from change
              history.
            </s-banner>
          </s-stack>
          <s-button
            slot="primary-action"
            variant="primary"
            commandFor="apply-fix"
            command="--hide"
            loading={busy("apply") || undefined}
            onClick={() =>
              submit(
                { intent: "apply", area: issue.action.area },
                { method: "post" },
              )
            }
          >
            {issue.action.label}
          </s-button>
          <s-button
            slot="secondary-actions"
            commandFor="apply-fix"
            command="--hide"
          >
            Cancel
          </s-button>
        </s-modal>
      )}
    </s-page>
  );
}

function AffectedProducts({ products, total }) {
  return (
    <s-section
      heading="Affected products"
      padding="none"
    >
      <s-table>
        <s-table-header-row>
          <s-table-header listSlot="primary">Product</s-table-header>
          <s-table-header>Type</s-table-header>
          <s-table-header>Category</s-table-header>
          <s-table-header format="numeric">Description</s-table-header>
          <s-table-header format="numeric">Images</s-table-header>
          <s-table-header>Actions</s-table-header>
        </s-table-header-row>
        <s-table-body>
          {products.map((product) => (
            <s-table-row key={product.id}>
              <s-table-cell>
                <s-stack direction="inline" gap="small" alignItems="center">
                  <s-thumbnail
                    src={product.imageUrl || undefined}
                    alt={product.title}
                    size="small"
                  />
                  <s-link
                    href={`/app/products/${encodeURIComponent(product.id.split("/").pop())}`}
                  >
                    {product.title}
                  </s-link>
                </s-stack>
              </s-table-cell>
              <s-table-cell>{product.productType || "–"}</s-table-cell>
              <s-table-cell>{product.category || "None"}</s-table-cell>
              <s-table-cell>{`${product.descriptionChars} chars`}</s-table-cell>
              <s-table-cell>
                {product.imagesMissingAlt
                  ? `${product.imageCount} (${product.imagesMissingAlt} no alt)`
                  : product.imageCount}
              </s-table-cell>
              <s-table-cell>
                <s-button
                  variant="tertiary"
                  href={adminProductUrl(product.id)}
                  target="_blank"
                >
                  Edit in Shopify
                </s-button>
              </s-table-cell>
            </s-table-row>
          ))}
        </s-table-body>
      </s-table>
      {total > products.length && (
        <s-box padding="base">
          <s-text color="subdued">
            {`Showing ${pluralize(products.length, "product")} of ${total.toLocaleString("en-US")}.`}
          </s-text>
        </s-box>
      )}
    </s-section>
  );
}

export const headers = (headersArgs) => boundary.headers(headersArgs);

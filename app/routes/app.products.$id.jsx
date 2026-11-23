import { useRef, useState } from "react";
import { useFetcher, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { readBody, requireStore } from "../services/guard.server";
import {
  generateDrafts,
  getProductWorkspace,
  publishDrafts,
  updateDraft,
} from "../services/products.server";
import { CodeBlock } from "../components/CodeBlock";
import { EvidenceBadge, adminProductUrl } from "../components/ui";
import { DRAFT_FIELDS, hasRichFormatting, readinessBand } from "../lib/products";
import { formatDateTime, formatMoney, truncateText } from "../lib/format";

export const loader = async ({ request, params }) => {
  const { admin, shop, redirect } = await requireStore(request);
  const workspace = await getProductWorkspace(admin, shop, params.id);
  if (!workspace) throw redirect("/app/products");
  return workspace;
};

export const action = async ({ request, params }) => {
  const { admin, shop, store } = await requireStore(request);
  const body = await readBody(request);
  try {
    switch (body.intent) {
      case "generate":
        return { ok: true, generated: await generateDrafts(admin, shop, params.id, store) };
      case "status":
        await updateDraft(shop, String(body.id), { status: body.status });
        return { ok: true };
      case "edit":
        await updateDraft(shop, String(body.id), { suggested: body.suggested, status: "accepted" });
        return { ok: true };
      case "publish":
        return { ok: true, published: await publishDrafts(admin, shop, params.id) };
      default:
        return null;
    }
  } catch (error) {
    return { ok: false, error: error.message };
  }
};

export default function ProductWorkspace() {
  const { product, readiness, stats, drafts, history } = useLoaderData();
  const act = useFetcher();
  const busy = (intent) => act.state !== "idle" && act.formData?.get("intent") === intent;
  const accepted = drafts.filter((draft) => draft.status === "accepted").length;
  const replacesRichDescription =
    hasRichFormatting(product.descriptionHtml) &&
    drafts.some(
      (draft) => draft.status === "accepted" && draft.field === "description",
    );
  const band = readiness ? readinessBand(readiness.score) : null;
  const numeric = product.id.split("/").pop();

  return (
    <s-page heading={product.title} inlineSize="large">
      <s-link slot="breadcrumb-actions" href="/app/products">
        Products
      </s-link>
      {accepted > 0 ? (
        <s-button slot="primary-action" variant="primary" commandFor="publish-drafts" command="--show">
          {`Publish ${accepted} ${accepted === 1 ? "change" : "changes"}`}
        </s-button>
      ) : (
        <s-button
          slot="primary-action"
          variant="primary"
          loading={busy("generate") || undefined}
          onClick={() => act.submit({ intent: "generate" }, { method: "post" })}
        >
          {drafts.length ? "Rewrite suggestions" : "Write suggestions"}
        </s-button>
      )}
      {accepted > 0 && (
        <s-button
          slot="secondary-actions"
          loading={busy("generate") || undefined}
          onClick={() => act.submit({ intent: "generate" }, { method: "post" })}
        >
          Rewrite suggestions
        </s-button>
      )}
      <s-button slot="secondary-actions" href={adminProductUrl(numeric)} target="_blank">
        View in Shopify
      </s-button>

      <s-stack direction="block" gap="base">
        <s-stack direction="inline" gap="small" alignItems="center">
          {band && <s-badge tone={band.tone}>{`Readiness ${readiness.score}`}</s-badge>}
          {drafts.length > 0 && <s-badge tone="info">{`${drafts.length} suggestions`}</s-badge>}
          <s-text color="subdued">
            {[
              product.priceRange && formatMoney(Number(product.priceRange.split("–")[0]), product.currency),
              `${product.variants} variants`,
              product.category ? product.category.split(" > ").pop() : "No category",
            ]
              .filter(Boolean)
              .join(" · ")}
          </s-text>
        </s-stack>

        {act.data?.error && (
          <s-banner tone="critical" heading="That didn't work">
            {act.data.error}
          </s-banner>
        )}
        {act.data?.published && (
          <s-banner tone="success" heading={`${act.data.published} ${act.data.published === 1 ? "change" : "changes"} published`}>
            The original values are saved in this product&apos;s history below.
          </s-banner>
        )}
        {act.data?.generated === 0 && (
          <s-banner tone="info" heading="No changes suggested">
            Your AI tool kept every field as it is.
          </s-banner>
        )}

        {drafts.length ? (
          DRAFT_FIELDS.map((field) => {
            const draft = drafts.find((item) => item.field === field.key);
            return draft ? <DraftField key={draft.id} field={field} draft={draft} /> : null;
          })
        ) : (
          <s-section>
            <s-stack direction="block" gap="small" alignItems="start">
              <s-heading>No suggestions yet</s-heading>
              <s-paragraph>
                GEO asks your connected AI tool to rewrite the title,
                description and search fields using only facts already in this
                product. You review every change before it&apos;s published.
              </s-paragraph>
            </s-stack>
          </s-section>
        )}

        <s-grid gridTemplateColumns="repeat(auto-fit, minmax(300px, 1fr))" gap="base">
          {readiness && (
            <s-section heading="Readiness">
              <s-stack direction="block" gap="small">
                {readiness.checks.map((check) => (
                  <s-stack key={check.key} direction="inline" gap="small" alignItems="center">
                    <s-badge tone={check.passed ? "success" : "warning"}>
                      {check.passed ? "Pass" : "Open"}
                    </s-badge>
                    <s-text>{check.label}</s-text>
                  </s-stack>
                ))}
                {stats && (
                  <s-text color="subdued">
                    {`${stats.descriptionChars} description characters · ${stats.imageCount} images${stats.imagesMissingAlt ? ` (${stats.imagesMissingAlt} without alt text)` : ""} · GTIN on ${stats.gtinCount} of ${stats.variantCount} variants`}
                  </s-text>
                )}
              </s-stack>
            </s-section>
          )}
          <s-section heading="What AI shopping agents receive">
            <s-stack direction="block" gap="small">
              <s-text color="subdued">
                The fields shared through Shopify Catalog today. This isn&apos;t an AI answer.
              </s-text>
              <CodeBlock
                text={[
                  `Title: ${product.title}`,
                  `Category: ${product.category ?? "none"}`,
                  product.priceRange && `Price: ${product.priceRange} ${product.currency ?? ""}`,
                  product.vendor && `Brand: ${product.vendor}`,
                  ...product.options
                    .filter((option) => option.name !== "Title")
                    .map((option) => `${option.name}: ${option.values.slice(0, 8).join(", ")}`),
                  `Description: ${truncateText(product.description, 300) || "none"}`,
                ]
                  .filter(Boolean)
                  .join("\n")}
              />
            </s-stack>
          </s-section>
        </s-grid>

        <s-section heading="History">
          {history.length ? (
            <s-stack direction="block" gap="small">
              {history.map((item) => (
                <s-text key={item.id}>
                  {`${formatDateTime(item.createdAt)} · ${item.title}${item.status === "restored" ? " (restored)" : ""}`}
                </s-text>
              ))}
            </s-stack>
          ) : (
            <s-text color="subdued">GEO hasn&apos;t changed this product yet.</s-text>
          )}
        </s-section>
      </s-stack>

      <s-modal id="publish-drafts" heading={`Publish ${accepted} ${accepted === 1 ? "change" : "changes"} to ${product.title}?`}>
        <s-stack direction="block" gap="base">
          <s-paragraph>
            The accepted fields are written to the product in Shopify. Nothing
            else is edited.
          </s-paragraph>
          {replacesRichDescription ? (
            <s-banner
              tone="warning"
              heading="This replaces your description's formatting"
            >
              The current description has links, images, tables or headings.
              The new one is plain paragraphs and bullet lists, so that
              formatting is lost. The current version is saved first and can be
              restored from AI visibility › Reports › Change history.
            </s-banner>
          ) : (
            <s-banner tone="info">
              The current values are saved first. You can restore them from AI
              visibility › Reports › Change history.
            </s-banner>
          )}
        </s-stack>
        <s-button
          slot="primary-action"
          variant="primary"
          commandFor="publish-drafts"
          command="--hide"
          loading={busy("publish") || undefined}
          onClick={() => act.submit({ intent: "publish" }, { method: "post" })}
        >
          Publish
        </s-button>
        <s-button slot="secondary-actions" commandFor="publish-drafts" command="--hide">
          Cancel
        </s-button>
      </s-modal>
    </s-page>
  );
}

const STATUS_LABEL = { draft: "To review", accepted: "Accepted", rejected: "Skipped" };

function DraftField({ field, draft }) {
  const fetcher = useFetcher();
  const [editing, setEditing] = useState(false);
  const textRef = useRef(null);
  const setStatus = (status) =>
    fetcher.submit({ intent: "status", id: draft.id, status }, { method: "post" });
  const status = fetcher.formData?.get("status") ?? draft.status;
  const words = (text) => String(text || "").split(/\s+/).filter(Boolean).length;

  return (
    <s-section heading={field.label}>
      <s-stack direction="block" gap="base">
        <s-stack direction="inline" gap="small" alignItems="center" justifyContent="space-between">
          <s-stack direction="inline" gap="small" alignItems="center">
            <EvidenceBadge evidence="documented" />
            <s-badge tone={status === "accepted" ? "success" : status === "rejected" ? "neutral" : "info"}>
              {STATUS_LABEL[status] ?? status}
            </s-badge>
          </s-stack>
          <s-stack direction="inline" gap="small-300">
            <s-button
              variant={status === "accepted" ? "secondary" : "tertiary"}
              onClick={() => setStatus("accepted")}
            >
              Accept
            </s-button>
            <s-button
              variant={status === "rejected" ? "secondary" : "tertiary"}
              onClick={() => setStatus("rejected")}
            >
              Skip
            </s-button>
            <s-button variant="tertiary" onClick={() => setEditing(!editing)}>
              {editing ? "Cancel edit" : "Edit"}
            </s-button>
          </s-stack>
        </s-stack>

        <s-stack direction="block" gap="small-300">
          <s-text color="subdued">{`Current · ${words(draft.current)} words`}</s-text>
          <CodeBlock lines={[{ text: draft.current || "(empty)", kind: "removed" }]} />
        </s-stack>
        <s-stack direction="block" gap="small-300">
          <s-text color="subdued">{`Suggested · ${words(draft.suggested)} words · ${draft.suggested.length} characters`}</s-text>
          {editing ? (
            <s-stack direction="block" gap="small">
              <s-text-area
                ref={textRef}
                label={`Edit ${field.label.toLowerCase()}`}
                labelAccessibilityVisibility="exclusive"
                value={draft.suggested}
                rows={field.key === "description" ? 10 : 2}
              />
              <s-stack direction="inline">
                <s-button
                  loading={fetcher.state !== "idle" || undefined}
                  onClick={() => {
                    fetcher.submit(
                      { intent: "edit", id: draft.id, suggested: textRef.current?.value ?? draft.suggested },
                      { method: "post" },
                    );
                    setEditing(false);
                  }}
                >
                  Save and accept
                </s-button>
              </s-stack>
            </s-stack>
          ) : (
            <CodeBlock lines={draft.suggested.split("\n").map((text) => ({ text, kind: "added" }))} />
          )}
        </s-stack>
      </s-stack>
    </s-section>
  );
}

export const headers = (headersArgs) => boundary.headers(headersArgs);

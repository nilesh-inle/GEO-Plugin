import { useRef, useState } from "react";
import { useFetcher, useLoaderData, useNavigate } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { readBody, requireStore } from "../services/guard.server";
import { generateDraftsFor, listProducts } from "../services/products.server";
import { FilterTabs, Metric, MetricGrid, downloadCsv } from "../components/ui";
import { useElementEvent } from "../hooks/useElementEvent";
import { MAX_BULK_DRAFTS, readinessBand } from "../lib/products";
import { pluralize } from "../lib/format";

export const loader = async ({ request }) => {
  const { shop } = await requireStore(request);
  const url = new URL(request.url);
  const list = await listProducts(shop, {
    view: url.searchParams.get("view") ?? "all",
    q: url.searchParams.get("q") ?? "",
    page: Number(url.searchParams.get("page")) || 1,
  });
  return {
    ...list,
    view: url.searchParams.get("view") ?? "all",
    q: url.searchParams.get("q") ?? "",
  };
};

export const action = async ({ request }) => {
  const { admin, shop, store } = await requireStore(request);
  const body = await readBody(request);
  if (body.intent !== "drafts") return null;
  const ids = (Array.isArray(body.ids) ? body.ids : []).map(String);
  if (!ids.length) return { ok: false, error: "Select products first." };
  try {
    return { ok: true, ...(await generateDraftsFor(admin, shop, ids, store)) };
  } catch (error) {
    return { ok: false, error: error.message };
  }
};

const numericId = (gid) => gid.split("/").pop();

export default function Products() {
  const data = useLoaderData();
  const navigate = useNavigate();
  const drafts = useFetcher();
  const [selected, setSelected] = useState([]);
  const searchRef = useRef(null);

  const go = (params) => {
    const next = new URLSearchParams({ view: data.view, q: data.q, page: "1", ...params });
    for (const [key, value] of [...next.entries()]) if (!value || value === "all") next.delete(key);
    navigate(`/app/products${next.toString() ? `?${next}` : ""}`);
  };
  useElementEvent(searchRef, "change", (event) =>
    go({ q: event.currentTarget.value ?? "" }),
  );
  const toggle = (id) =>
    setSelected((list) =>
      list.includes(id)
        ? list.filter((item) => item !== id)
        : list.length >= MAX_BULK_DRAFTS
          ? list
          : [...list, id],
    );

  const exportCsv = () =>
    downloadCsv(
      "geo-products.csv",
      ["Product", "Readiness", "Top gap", "Category", "Description characters", "Images", "Images without alt", "GTIN variants"],
      data.rows.map((row) => [
        row.title,
        row.score,
        row.gap ?? "",
        row.category ?? "",
        row.descriptionChars,
        row.imageCount,
        row.imagesMissingAlt,
        row.gtinCount,
      ]),
    );

  return (
    <s-page heading="Products" inlineSize="large">
      <s-button
        slot="primary-action"
        variant="primary"
        disabled={!selected.length || undefined}
        loading={drafts.state !== "idle" || undefined}
        onClick={() =>
          drafts.submit({ intent: "drafts", ids: selected }, { method: "post", encType: "application/json" })
        }
      >
        {selected.length ? `Draft ${pluralize(selected.length, "product")}` : "Draft selected"}
      </s-button>
      <s-button slot="secondary-actions" onClick={exportCsv}>
        Export CSV
      </s-button>

      <s-stack direction="block" gap="base">
        <s-text color="subdued">
          {`${pluralize(data.total, "active product")} · readiness updates after every sync and publish`}
        </s-text>

        {drafts.data?.ok && (
          <s-banner tone="success" heading={`Drafts ready for ${pluralize(drafts.data.products, "product")}`}>
            {`${drafts.data.fields} suggested changes are waiting. Open a product to review and publish them.`}
            <s-button slot="secondary-actions" onClick={() => { setSelected([]); go({ view: "drafts" }); }}>
              Show products with drafts
            </s-button>
          </s-banner>
        )}
        {drafts.data?.error && (
          <s-banner tone="critical" heading="Drafts weren't written">
            {drafts.data.error}
          </s-banner>
        )}

        <MetricGrid min={160}>
          <Metric
            label="Average readiness"
            value={data.average == null ? "–" : `${data.average} / 100`}
            help="Category, description, images, GTIN, brand and reviews"
          />
          {data.distribution.map((band) => (
            <Metric
              key={band.key}
              label={`${band.label} (${band.min}–${band.max})`}
              value={band.count}
            />
          ))}
        </MetricGrid>

        <s-section padding="none" accessibilityLabel="Products">
          <s-box padding="base">
            <s-stack direction="block" gap="base">
              <FilterTabs
                tabs={data.views}
                current={data.view}
                onSelect={(view) => go({ view })}
              />
              <s-search-field
                label="Search products"
                labelAccessibilityVisibility="exclusive"
                placeholder="Search by title, vendor or type"
                value={data.q}
                ref={searchRef}
              />
              {selected.length > 0 && (
                <s-stack direction="inline" gap="small" alignItems="center">
                  <s-text>{`${selected.length} selected (up to ${MAX_BULK_DRAFTS} at a time) · uses your connected AI tool`}</s-text>
                  <s-button variant="tertiary" onClick={() => setSelected([])}>
                    Clear
                  </s-button>
                </s-stack>
              )}
            </s-stack>
          </s-box>
          {data.rows.length ? (
            <s-table>
              <s-table-header-row>
                <s-table-header>Select</s-table-header>
                <s-table-header listSlot="primary">Product</s-table-header>
                <s-table-header>Readiness</s-table-header>
                <s-table-header>Top gap</s-table-header>
                <s-table-header>Category</s-table-header>
                <s-table-header format="numeric">Description</s-table-header>
                <s-table-header format="numeric">Images</s-table-header>
                <s-table-header>Drafts</s-table-header>
              </s-table-header-row>
              <s-table-body>
                {data.rows.map((row) => {
                  const band = readinessBand(row.score);
                  return (
                    <s-table-row key={row.id}>
                      <s-table-cell>
                        <SelectBox
                          label={`Select ${row.title}`}
                          checked={selected.includes(row.id)}
                          onToggle={() => toggle(row.id)}
                        />
                      </s-table-cell>
                      <s-table-cell>
                        <s-stack direction="inline" gap="small" alignItems="center">
                          <s-thumbnail src={row.imageUrl || undefined} alt={row.title} size="small" />
                          <s-stack direction="block" gap="small-400">
                            <s-link href={`/app/products/${numericId(row.id)}`}>{row.title}</s-link>
                            <s-text color="subdued">{[row.vendor, row.productType].filter(Boolean).join(" · ") || " "}</s-text>
                          </s-stack>
                        </s-stack>
                      </s-table-cell>
                      <s-table-cell>
                        <s-badge tone={band.tone}>{`${row.score} · ${band.label}`}</s-badge>
                      </s-table-cell>
                      <s-table-cell>{row.gap ?? "–"}</s-table-cell>
                      <s-table-cell>{row.category ? row.category.split(" > ").pop() : "None"}</s-table-cell>
                      <s-table-cell>{`${row.descriptionChars} chars`}</s-table-cell>
                      <s-table-cell>{row.imageCount}</s-table-cell>
                      <s-table-cell>
                        {row.drafts ? (
                          <s-link href={`/app/products/${numericId(row.id)}`}>{`${row.drafts} to review`}</s-link>
                        ) : (
                          "–"
                        )}
                      </s-table-cell>
                    </s-table-row>
                  );
                })}
              </s-table-body>
            </s-table>
          ) : (
            <s-box padding="large">
              <s-text color="subdued">
                {data.total
                  ? "No products match."
                  : "No active products synced. Add products in Shopify, then re-run the audit."}
              </s-text>
            </s-box>
          )}
          <s-box padding="base">
            <s-stack direction="inline" gap="small" alignItems="center" justifyContent="space-between">
              <s-text color="subdued">
                {`${data.matching ? `${(data.page - 1) * 25 + 1}–${Math.min(data.page * 25, data.matching)} of ${data.matching}` : "0"} · lowest readiness first`}
              </s-text>
              <s-stack direction="inline" gap="small-300">
                <s-button
                  variant="secondary"
                  icon="chevron-left"
                  accessibilityLabel="Previous page"
                  disabled={data.page <= 1 || undefined}
                  onClick={() => go({ page: String(data.page - 1) })}
                />
                <s-button
                  variant="secondary"
                  icon="chevron-right"
                  accessibilityLabel="Next page"
                  disabled={data.page >= data.pages || undefined}
                  onClick={() => go({ page: String(data.page + 1) })}
                />
              </s-stack>
            </s-stack>
          </s-box>
        </s-section>
      </s-stack>
    </s-page>
  );
}

function SelectBox({ label, checked, onToggle }) {
  const ref = useRef(null);
  useElementEvent(ref, "change", onToggle);
  return (
    <s-checkbox ref={ref} accessibilityLabel={label} checked={checked || undefined} />
  );
}

export const headers = (headersArgs) => boundary.headers(headersArgs);

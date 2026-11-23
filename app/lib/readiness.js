/**
 * AI readiness score: a weighted share of passed checks, 0-100. It measures
 * what GEO can verify about the store's data. It never predicts rankings.
 * Pure functions; inputs are the same as detectIssues() (app/lib/issues.js).
 */
import { SEARCH_CRAWLERS, SHORT_DESCRIPTION_CHARS } from "./issues";
import { REQUIRED_POLICIES } from "./policies";

export const READINESS_AREAS = [
  { key: "catalog", label: "Catalog data", weight: 0.4 },
  { key: "crawl", label: "Crawl access", weight: 0.2 },
  { key: "policies", label: "Policies and trust", weight: 0.15 },
  { key: "content", label: "Content coverage", weight: 0.15 },
  { key: "schema", label: "Structured data", weight: 0.1 },
];

const share = (part, total) => (total > 0 ? Math.min(1, part / total) : 1);

/** Weighted average of [weight, value 0..1] pairs, as 0-100. */
function weighted(checks) {
  const total = checks.reduce((sum, [weight]) => sum + weight, 0);
  if (!total) return null;
  const value = checks.reduce((sum, [weight, part]) => sum + weight * part, 0);
  return Math.round((value / total) * 100);
}

function catalogScore({ catalog }) {
  if (!catalog?.products) return null;
  const n = catalog.products;
  return {
    score: weighted([
      [25, share(catalog.withCategory, n)],
      [30, share(catalog.longDescriptions, n)],
      [15, share(catalog.withImages, n)],
      [10, share(catalog.imagesWithAlt, catalog.images)],
      [10, share(catalog.withGtin, n)],
      [10, share(catalog.withVendor, n)],
    ]),
    checks: [
      ["Product category set", catalog.withCategory, n],
      [
        `Description of ${SHORT_DESCRIPTION_CHARS}+ characters`,
        catalog.longDescriptions,
        n,
      ],
      ["At least one image", catalog.withImages, n],
      ["Images with alt text", catalog.imagesWithAlt, catalog.images],
      ["GTIN or barcode", catalog.withGtin, n],
      ["Brand (vendor) set", catalog.withVendor, n],
    ],
  };
}

function crawlScore({ audit }) {
  if (!audit) return null;
  if (audit.passwordProtected)
    return { score: 0, checks: [["Storefront is public", 0, 1]] };
  const crawlers = audit.robots?.crawlers ?? [];
  const search = crawlers.filter((crawler) =>
    SEARCH_CRAWLERS.some((item) => item.agent === crawler.agent),
  );
  const allowed = search.filter((crawler) => crawler.allowed).length;
  const llmsOk = audit.llms?.status === "ok" ? 1 : 0;
  return {
    score: weighted([
      [80, share(allowed, search.length)],
      [20, llmsOk],
    ]),
    checks: [
      ["Storefront is public", 1, 1],
      ["AI search crawlers allowed", allowed, search.length],
      ["llms.txt describes the store", llmsOk, 1],
    ],
  };
}

function policyScore({ shopFacts, store }) {
  if (!shopFacts?.policyTypes) return null;
  const present = REQUIRED_POLICIES.filter((policy) =>
    shopFacts.policyTypes.includes(policy.type),
  ).length;
  const window = shopFacts.refundWindowDays ? 1 : 0;
  const contact = store?.contactEmail ? 1 : 0;
  return {
    score: weighted([
      [60, share(present, REQUIRED_POLICIES.length)],
      [25, window],
      [15, contact],
    ]),
    checks: [
      ["Required policies published", present, REQUIRED_POLICIES.length],
      ["Refund policy states a return window", window, 1],
      ["Contact email set", contact, 1],
    ],
  };
}

function contentScore({ collections, store, brandFacts = 0 }) {
  const total = collections?.total ?? 0;
  const described = collections?.described ?? 0;
  const storeDescription = String(store?.description || "").trim() ? 1 : 0;
  const facts = brandFacts >= 3 ? 1 : 0;
  return {
    score: weighted([
      [60, share(described, total)],
      [20, storeDescription],
      [20, facts],
    ]),
    checks: [
      ["Collections with a description", described, total],
      ["Store description set", storeDescription, 1],
      ["Brand facts recorded", facts, 1],
    ],
  };
}

function schemaScore({ audit, embedEnabled }) {
  const schema = audit?.schema;
  if (!schema || schema.status === "unknown") return null;
  const fields = (schema.fields ?? []).filter((item) => item.status !== "info");
  const ok = fields.filter((item) => item.status === "ok").length;
  const clean =
    schema.scanned > 0
      ? 1 -
        share(
          Math.max(schema.duplicatePages ?? 0, schema.invalidPages ?? 0),
          schema.scanned,
        )
      : 1;
  return {
    score: weighted([
      [70, share(ok, fields.length)],
      [20, clean],
      [10, embedEnabled ? 1 : 0],
    ]),
    checks: [
      ["Markup fields complete", ok, fields.length],
      [
        "Pages with one valid Product markup",
        Math.round(clean * schema.scanned),
        schema.scanned,
      ],
      ["GEO app embed on", embedEnabled ? 1 : 0, 1],
    ],
  };
}

const SCORERS = {
  catalog: catalogScore,
  crawl: crawlScore,
  policies: policyScore,
  content: contentScore,
  schema: schemaScore,
};

/**
 * @returns {{ score: number|null, areas: Array<{key,label,weight,score,checks}> }}
 * Areas without data are left out and the remaining weights are rescaled.
 */
export function computeReadiness(input) {
  const areas = READINESS_AREAS.map((area) => {
    const result = SCORERS[area.key](input);
    return {
      ...area,
      score: result?.score ?? null,
      checks: (result?.checks ?? []).map(([label, passed, total]) => ({
        label,
        passed,
        total,
      })),
    };
  });
  const scored = areas.filter((area) => area.score != null);
  const weight = scored.reduce((sum, area) => sum + area.weight, 0);
  const score = weight
    ? Math.round(
        scored.reduce((sum, area) => sum + area.score * area.weight, 0) /
          weight,
      )
    : null;
  return { score, areas };
}

/**
 * Checklist for AI shopping channels (Shopify Catalog feeds ChatGPT, Copilot,
 * Gemini and others). Status: ready | attention | manual (apps can't read it).
 */
export function channelChecks({ audit, shopFacts, catalog }) {
  const checks = [];
  if (audit)
    checks.push({
      key: "public",
      label: "Storefront is public",
      status: audit.passwordProtected ? "attention" : "ready",
      detail: audit.passwordProtected
        ? "A storefront password keeps every crawler and Shopify Catalog out."
        : "Crawlers and AI shopping agents can open your store.",
      href: audit.passwordProtected ? "shopify://admin/online_store/preferences" : null,
    });
  if (shopFacts?.policyTypes) {
    const present = REQUIRED_POLICIES.filter((policy) =>
      shopFacts.policyTypes.includes(policy.type),
    );
    checks.push({
      key: "policies",
      label: "Required policies are set",
      status: present.length === REQUIRED_POLICIES.length ? "ready" : "attention",
      detail:
        present.length === REQUIRED_POLICIES.length
          ? "Terms of service, privacy policy, and return and refund policy are filled in."
          : `Missing: ${REQUIRED_POLICIES.filter((policy) => !present.includes(policy)).map((policy) => policy.label.toLowerCase()).join(", ")}.`,
      href: present.length === REQUIRED_POLICIES.length ? null : "/app/fixes/policies.missing",
    });
    if (shopFacts.policyTypes.includes("REFUND_POLICY"))
      checks.push({
        key: "returnWindow",
        label: shopFacts.refundWindowDays
          ? `Refund policy states a ${shopFacts.refundWindowDays}-day return window`
          : "Refund policy doesn't state a return window",
        status: shopFacts.refundWindowDays ? "ready" : "attention",
        detail: shopFacts.refundWindowDays
          ? "Agents can answer “how long do I have to return it?”"
          : "Agents can't answer “how long do I have to return it?” accurately.",
        href: shopFacts.refundWindowDays ? null : "/app/fixes/policies.returnWindow",
      });
  }
  if (catalog?.products != null)
    checks.push({
      key: "products",
      label: "Active products to list",
      status: catalog.products > 0 ? "ready" : "attention",
      detail: `${catalog.products.toLocaleString("en-US")} active products${catalog.giftCards ? ` · ${catalog.giftCards} gift cards excluded` : ""}`,
      href: null,
    });
  // Product fields Shopify's guidance says AI shopping channels read through
  // Shopify Catalog: category, barcode, description and images.
  if (catalog?.products > 0 && catalog.withCategory != null) {
    const total = catalog.products;
    const fields = [
      {
        key: "catalogCategory",
        label: "Products have a product category",
        count: catalog.withCategory,
        issue: "catalog.category",
        why: "AI channels use the category to match products to what shoppers ask for.",
      },
      {
        key: "catalogBarcode",
        label: "Products have a barcode",
        count: catalog.withGtin,
        issue: "catalog.gtin",
        why: "Barcodes help AI channels recognise the exact item.",
      },
      {
        key: "catalogDescription",
        label: `Descriptions of ${SHORT_DESCRIPTION_CHARS}+ characters`,
        count: catalog.longDescriptions,
        issue: "catalog.description",
        why: "AI channels answer from your title and description first.",
      },
      {
        key: "catalogImages",
        label: "Products have an image",
        count: catalog.withImages,
        issue: "catalog.images",
        why: "Shopping answers show product images.",
      },
    ];
    for (const field of fields) {
      const ready = field.count >= total;
      checks.push({
        key: field.key,
        label: field.label,
        status: ready ? "ready" : "attention",
        detail: ready
          ? `All ${total.toLocaleString("en-US")} products`
          : `${field.count.toLocaleString("en-US")} of ${total.toLocaleString("en-US")} products. ${field.why}`,
        href: ready ? null : `/app/fixes/${field.issue}`,
      });
    }
  }
  if (shopFacts?.shipsTo)
    checks.push({
      key: "us",
      label: shopFacts.shipsTo.includes("US")
        ? "Ships to the United States"
        : "Doesn't ship to the United States",
      status: shopFacts.shipsTo.includes("US") ? "ready" : "manual",
      detail: "Several AI shopping features launched in the United States first.",
      href: null,
    });
  if (audit?.robots?.crawlers?.length) {
    const blocked = audit.robots.blocked ?? [];
    checks.push({
      key: "crawlers",
      label: blocked.length ? "AI search crawlers are blocked" : "AI search crawlers allowed",
      status: blocked.length ? "attention" : "ready",
      detail: blocked.length
        ? `${blocked.join(", ")} can't read your store.`
        : "OAI-SearchBot, PerplexityBot, Claude-SearchBot, Googlebot and Bingbot can read your store.",
      href: blocked.length ? "/app/fixes/crawl.blocked" : "/app/access",
    });
  }
  checks.push({
    key: "agentic",
    label: "Shopify Catalog eligibility",
    status: "manual",
    detail:
      "Apps can't read this. In Shopify admin, open Sales channels › Agentic to see whether your products are in Shopify Catalog, and use Channel mapping if your title or description lives in custom fields.",
    href: "shopify://admin/settings/apps",
  });
  return checks;
}

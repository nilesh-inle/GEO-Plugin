/**
 * llms.txt generation (https://llmstxt.org) and analysis of live files.
 * Pure functions: no network.
 */
import { GEO_MARKER, LIMITS } from "./constants";
import { formatMoney, truncateText } from "./format";

const POLICY_ORDER = [
  "SHIPPING_POLICY",
  "REFUND_POLICY",
  "PRIVACY_POLICY",
  "TERMS_OF_SERVICE",
  "CONTACT_INFORMATION",
];

const escapeLinkText = (text) =>
  String(text || "").replace(/([[\]\\])/g, "\\$1");
const time = (value) => new Date(value || 0).getTime();

export function selectTopProducts(products, limit = LIMITS.llmsProducts) {
  return products
    .filter((product) => product.status === "ACTIVE" && product.url)
    .sort(
      (a, b) =>
        Number(b.available) - Number(a.available) ||
        (b.ratingCount ?? 0) - (a.ratingCount ?? 0) ||
        time(b.updatedAt) - time(a.updatedAt),
    )
    .slice(0, limit);
}

export function selectCollections(collections, limit = LIMITS.llmsCollections) {
  return collections
    .filter((collection) => collection.productsCount > 0)
    .sort((a, b) => b.productsCount - a.productsCount)
    .slice(0, limit);
}

function storeSummary(store, collections) {
  const description = truncateText(store.description, 300);
  if (description) return description;
  const names = collections.slice(0, 3).map((collection) => collection.title);
  if (!names.length) return `${store.name} online store.`;
  const list =
    names.length > 1
      ? `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`
      : names[0];
  return `${store.name} sells ${list.toLowerCase()} online.`;
}

function productLine(product, currency) {
  const details = [];
  const description = truncateText(product.description, 140);
  if (description) details.push(description.replace(/[.…]?$/, "."));

  const min = formatMoney(product.minPrice, currency);
  if (min) {
    const hasRange =
      product.maxPrice != null && product.maxPrice > product.minPrice;
    details.push(hasRange ? `From ${min}.` : `${min}.`);
  }
  details.push(product.available ? "In stock." : "Out of stock.");

  return `- [${escapeLinkText(product.title)}](${product.url}): ${details.join(" ")}`;
}

function collectionLine(collection, storeUrl) {
  const description = truncateText(collection.description, 120);
  const count = `${collection.productsCount} product${collection.productsCount === 1 ? "" : "s"}`;
  const details = description
    ? `${description.replace(/[.…]?$/, ".")} ${count}.`
    : `${count}.`;
  return `- [${escapeLinkText(collection.title)}](${storeUrl}/collections/${collection.handle}): ${details}`;
}

/**
 * Builds llms.txt markdown for the store.
 * @returns {{ markdown: string, stats: { collections: number, products: number, policies: number } }}
 */
export function buildLlmsTxt({
  store,
  products,
  collections,
  facts = [],
  agentsFile = false,
}) {
  const storeUrl = String(store.url || "").replace(/\/$/, "");
  const topCollections = selectCollections(collections);
  const topProducts = selectTopProducts(products);
  const policies = [...(store.policies || [])]
    .filter((policy) => policy.url)
    .sort(
      (a, b) => POLICY_ORDER.indexOf(a.type) - POLICY_ORDER.indexOf(b.type),
    );

  const lines = [
    `# ${store.name}`,
    "",
    `> ${storeSummary(store, topCollections)}`,
    "",
  ];

  lines.push(`- Website: ${storeUrl}`);
  if (store.currency) lines.push(`- Prices in: ${store.currency}`);
  if (store.contactEmail) lines.push(`- Contact: ${store.contactEmail}`);

  const storeFacts = facts.filter(
    (fact) => String(fact.label).trim() && String(fact.value).trim(),
  );
  if (storeFacts.length) {
    lines.push(
      "",
      "## Store facts",
      "",
      ...storeFacts.map(
        (fact) =>
          `- ${String(fact.label).trim().replace(/\s+/g, " ")}: ${String(fact.value).trim().replace(/\s+/g, " ")}`,
      ),
    );
  }

  if (topCollections.length) {
    lines.push(
      "",
      "## Collections",
      "",
      ...topCollections.map((collection) =>
        collectionLine(collection, storeUrl),
      ),
    );
  }
  if (topProducts.length) {
    lines.push(
      "",
      "## Top products",
      "",
      ...topProducts.map((product) => productLine(product, store.currency)),
    );
  }
  if (policies.length) {
    lines.push(
      "",
      "## Policies",
      "",
      ...policies.map(
        (policy) => `- [${escapeLinkText(policy.title)}](${policy.url})`,
      ),
    );
  }

  lines.push(
    "",
    "## Optional",
    "",
    `- [All products](${storeUrl}/collections/all)`,
    `- [Sitemap](${storeUrl}/sitemap.xml)`,
  );
  if (agentsFile)
    lines.push(
      `- [Agent instructions and shopping protocol details](${storeUrl}/agents.md)`,
    );

  return {
    markdown: `${lines.join("\n")}\n`,
    stats: {
      collections: topCollections.length,
      products: topProducts.length,
      policies: policies.length,
      facts: storeFacts.length,
    },
  };
}

/**
 * Wraps markdown for templates/llms.txt.liquid. `{% raw %}` stops product
 * text containing `{{` or `{%` from being executed as Liquid.
 */
export function toLlmsTemplate(markdown) {
  const safe = markdown.replace(/\{%-?\s*endraw\s*-?%\}/gi, "");
  return `{%- comment -%}${GEO_MARKER}. Regenerated when your catalog changes; edits here are overwritten.{%- endcomment -%}\n{% raw %}${safe}{% endraw %}\n`;
}

export function isManagedLlmsTemplate(content) {
  return String(content || "").includes(GEO_MARKER);
}

const uniqueMatches = (text, pattern) =>
  new Set(String(text || "").match(pattern) || []).size;

/** What a live llms.txt / agents.md tells AI about the store. */
export function analyzeLlmsContent(text) {
  return {
    collections: uniqueMatches(text, /\/collections\/(?!all(?![\w-]))[\w-]+/gi),
    products: uniqueMatches(text, /\/products\/[\w-]+/gi),
    policies: uniqueMatches(text, /\/policies\/[\w-]+/gi),
  };
}

/**
 * Fix list: turns the latest audit and catalog counts into ranked issues.
 * Pure functions, safe on the client. Inputs come from
 * app/services/issues.server.js (getIssueInputs).
 *
 * Evidence labels follow the design: Documented (a platform says so),
 * Research-backed, Hypothesis (plausible, unproven), Experimental.
 */
import { AI_CRAWLERS, FIXABLE_CRAWLER_PURPOSES } from "./constants";
import { missingPolicies } from "./policies";

export const AREAS = {
  catalog: "Catalog data",
  policies: "Policies & trust",
  crawl: "Crawl access",
  schema: "Structured data",
  content: "Content",
};

export const IMPACT = {
  critical: { label: "Critical", rank: 4, tone: "critical" },
  high: { label: "High", rank: 3, tone: "warning" },
  medium: { label: "Medium", rank: 2, tone: "caution" },
  low: { label: "Low", rank: 1, tone: "neutral" },
};

export const EVIDENCE = {
  documented: { label: "Documented", tone: "info" },
  research: { label: "Research-backed", tone: "info" },
  hypothesis: { label: "Hypothesis", tone: "neutral" },
  experimental: { label: "Experimental", tone: "neutral" },
};

/** Sort weight for issues that affect the whole store. */
const WHOLE_STORE = 1_000_000_000;

/** Descriptions shorter than this rarely answer a shopper's question. */
export const SHORT_DESCRIPTION_CHARS = 150;

const SOURCES = {
  category: {
    label: "Shopify: product category",
    url: "https://help.shopify.com/en/manual/products/details/product-category",
  },
  policies: {
    label: "Shopify: store policies",
    url: "https://help.shopify.com/en/manual/checkout-settings/refund-privacy-tos",
  },
  password: {
    label: "Shopify: password page",
    url: "https://help.shopify.com/en/manual/online-store/themes/password-page",
  },
  bots: {
    label: "OpenAI: crawlers",
    url: "https://platform.openai.com/docs/bots",
  },
  robots: {
    label: "Shopify: robots.txt.liquid",
    url: "https://shopify.dev/docs/storefronts/themes/seo/robots-txt",
  },
  productSchema: {
    label: "Google: product structured data",
    url: "https://developers.google.com/search/docs/appearance/structured-data/product",
  },
  gtin: {
    label: "Google: product identifiers",
    url: "https://support.google.com/merchants/answer/6324461",
  },
  alt: {
    label: "Google: image alt text",
    url: "https://developers.google.com/search/docs/appearance/google-images",
  },
  llms: { label: "llms.txt proposal", url: "https://llmstxt.org/" },
};

const ADMIN = {
  products: "shopify://admin/products",
  collections: "shopify://admin/collections",
  policies: "shopify://admin/settings/legal",
  preferences: "shopify://admin/online_store/preferences",
  general: "shopify://admin/settings/general",
};

const plural = (n, one, many = `${one}s`) =>
  `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;

function issue(definition) {
  return {
    evidence: "documented",
    sources: [],
    ...definition,
    rank: IMPACT[definition.impact].rank,
  };
}

function crawlIssues({ audit }) {
  const issues = [];
  if (audit?.passwordProtected) {
    issues.push(
      issue({
        key: "crawl.password",
        area: "crawl",
        title: "Your storefront is password protected",
        description: "No crawler, AI tool or Shopify Catalog can read it",
        affects: "Whole store",
        count: WHOLE_STORE,
        impact: "critical",
        fixType: "Guided",
        action: {
          kind: "link",
          href: ADMIN.preferences,
          label: "Open preferences",
        },
        whatsWrong:
          "Your online store is behind a password page. Crawlers and AI shopping agents see the password page instead of your products.",
        whyItMatters:
          "Nothing GEO fixes can reach AI tools until the storefront is public.",
        fix: "Remove the password in Online Store › Preferences when you're ready to launch.",
        sources: [SOURCES.password],
      }),
    );
  }

  const blocked = audit?.robots?.blocked ?? [];
  if (blocked.length) {
    issues.push(
      issue({
        key: "crawl.blocked",
        area: "crawl",
        title: `${plural(blocked.length, "AI search crawler")} blocked in robots.txt`,
        description: `${blocked.join(", ")} can't read your store`,
        affects: "Whole store",
        count: WHOLE_STORE,
        impact: "critical",
        fixType: "App fix",
        action: { kind: "apply", area: "robots", label: "Allow crawlers" },
        whatsWrong: `robots.txt tells ${blocked.join(", ")} not to read some or all of your pages.`,
        whyItMatters:
          "An AI tool can only cite pages its search crawler is allowed to read. Training crawlers stay your choice and are never changed.",
        fix: "GEO adds an allow rule for these crawlers to templates/robots.txt.liquid and keeps Shopify's default rules.",
        sources: [SOURCES.bots, SOURCES.robots],
        items: blocked.map((agent) => {
          const crawler = AI_CRAWLERS.find((item) => item.agent === agent);
          return {
            title: agent,
            detail: crawler?.usedFor ?? "",
          };
        }),
      }),
    );
  }

  const llms = audit?.llms;
  if (llms && llms.status === "issue") {
    issues.push(
      issue({
        key: "crawl.llms",
        area: "crawl",
        title: "llms.txt doesn't describe your store",
        description:
          llms.findings?.[0]?.text ?? "llms.txt is missing or incomplete",
        affects: "Whole store",
        count: 1,
        impact: "low",
        evidence: "experimental",
        fixType: "App fix",
        action: { kind: "apply", area: "llms", label: "Publish llms.txt" },
        whatsWrong: (llms.findings ?? []).map((item) => item.text).join(". "),
        whyItMatters:
          "llms.txt is a proposed standard. Some AI tools read it; Google says it doesn't use it. It is cheap to keep current.",
        fix: "GEO publishes a summary of your collections, top products and policies at /llms.txt and keeps it updated.",
        sources: [SOURCES.llms],
      }),
    );
  }
  return issues;
}

function policyIssues({ shopFacts }) {
  const issues = [];
  const missing = missingPolicies(shopFacts?.policyTypes ?? []);
  if (shopFacts?.policyTypes && missing.length) {
    issues.push(
      issue({
        key: "policies.missing",
        area: "policies",
        title: `${plural(missing.length, "required policy", "required policies")} missing`,
        description: missing.map((policy) => policy.label).join(", "),
        affects: "Whole store",
        count: WHOLE_STORE,
        impact: "high",
        fixType: "Guided",
        action: { kind: "link", href: ADMIN.policies, label: "Open policies" },
        whatsWrong: `Your store has no ${missing.map((policy) => policy.label.toLowerCase()).join(", ")}.`,
        whyItMatters:
          "Shopify requires these policies before products are offered to AI shopping channels, and assistants quote them when shoppers ask.",
        fix: "Fill them in under Settings › Policies. Shopify can generate a template you then edit.",
        sources: [SOURCES.policies],
      }),
    );
  }

  const hasRefund = shopFacts?.policyTypes?.includes("REFUND_POLICY");
  if (hasRefund && !shopFacts.refundWindowDays) {
    issues.push(
      issue({
        key: "policies.returnWindow",
        area: "policies",
        title: "Refund policy doesn't state your return window",
        description: "Assistants can't answer “how long do I have to return it?”",
        affects: "Whole store",
        count: WHOLE_STORE,
        impact: "high",
        fixType: "Guided",
        action: { kind: "link", href: ADMIN.policies, label: "Edit policy" },
        whatsWrong:
          "Your refund policy doesn't say how many days shoppers have to return an item.",
        whyItMatters:
          "AI shopping agents read the Shopify refund policy. Without a stated window they guess or skip the question, and a wrong answer costs trust.",
        fix: "Add one sentence such as “You can return items within 30 days of delivery.” to your refund policy.",
        sources: [SOURCES.policies],
      }),
    );
  }
  return issues;
}

function catalogIssues({ catalog }) {
  if (!catalog?.products) return [];
  const issues = [];
  const n = catalog.products;

  const noCategory = n - catalog.withCategory;
  if (noCategory > 0) {
    issues.push(
      issue({
        key: "catalog.category",
        area: "catalog",
        title: `${plural(noCategory, "product")} have no product category`,
        description: "Shopify's standard taxonomy category is empty",
        affects: plural(noCategory, "product"),
        count: noCategory,
        impact: noCategory / n > 0.2 ? "high" : "medium",
        fixType: "Guided",
        action: {
          kind: "link",
          href: `${ADMIN.products}?category_id=none`,
          label: "Set categories",
        },
        whatsWrong:
          "These products have no category from Shopify's Standard Product Taxonomy.",
        whyItMatters:
          "Shopify Catalog classifies products by category and attributes before sharing them with AI shopping channels. Shopify recommends the most specific category possible.",
        fix: "Pick a category on each product, or use the bulk editor. Shopify often suggests one.",
        sources: [SOURCES.category],
        productFilter: "noCategory",
      }),
    );
  }

  const shortDescriptions = n - catalog.longDescriptions;
  if (shortDescriptions > 0) {
    issues.push(
      issue({
        key: "catalog.description",
        area: "catalog",
        title: `${plural(shortDescriptions, "product description")} too thin for AI answers`,
        description: `Under ${SHORT_DESCRIPTION_CHARS} characters: no specs, materials or sizing`,
        affects: plural(shortDescriptions, "product"),
        count: shortDescriptions,
        impact: shortDescriptions / n > 0.2 ? "high" : "medium",
        fixType: "AI drafts",
        action: {
          kind: "link",
          href: "/app/products?view=thin",
          label: "Draft descriptions",
        },
        whatsWrong: `These descriptions are shorter than ${SHORT_DESCRIPTION_CHARS} characters.`,
        whyItMatters:
          "Assistants answer from the facts on the page. A short description leaves out the material, size and use cases shoppers ask about.",
        fix: "Open a product in GEO to draft a fuller description with your connected AI tool, review it, then publish.",
        sources: [SOURCES.productSchema],
        productFilter: "thin",
      }),
    );
  }

  const noGtin = n - catalog.withGtin;
  if (noGtin > 0) {
    issues.push(
      issue({
        key: "catalog.gtin",
        area: "catalog",
        title: `${plural(noGtin, "product")} missing a GTIN or barcode`,
        description: "Identifiers help AI match your product across sources",
        affects: plural(noGtin, "product"),
        count: noGtin,
        impact: "medium",
        fixType: "Manual",
        action: { kind: "link", href: ADMIN.products, label: "Open products" },
        whatsWrong:
          "No variant of these products has a valid GTIN (UPC, EAN or ISBN) in its barcode field.",
        whyItMatters:
          "GTINs let shopping systems recognise the same product across stores and reviews. Products you make yourself may not have one; that's fine.",
        fix: "Add barcodes in Shopify, one by one or through a CSV import.",
        sources: [SOURCES.gtin],
        productFilter: "noGtin",
      }),
    );
  }

  const noImages = n - catalog.withImages;
  if (noImages > 0) {
    issues.push(
      issue({
        key: "catalog.images",
        area: "catalog",
        title: `${plural(noImages, "product")} have no images`,
        description: "Shopping answers show a picture next to each product",
        affects: plural(noImages, "product"),
        count: noImages,
        impact: "medium",
        fixType: "Manual",
        action: { kind: "link", href: ADMIN.products, label: "Open products" },
        whatsWrong: "These products have no image.",
        whyItMatters:
          "AI shopping answers and Shopify Catalog show product images. Products without one are less likely to be shown.",
        fix: "Upload at least one product image in Shopify.",
        sources: [SOURCES.productSchema],
        productFilter: "noImages",
      }),
    );
  }

  const missingAlt = catalog.images - catalog.imagesWithAlt;
  if (missingAlt > 0) {
    issues.push(
      issue({
        key: "catalog.alt",
        area: "catalog",
        title: `${plural(missingAlt, "image")} missing alt text`,
        description: "Helps accessibility and image understanding",
        affects: plural(missingAlt, "image"),
        count: missingAlt,
        impact: "low",
        fixType: "Manual",
        action: { kind: "link", href: ADMIN.products, label: "Open products" },
        whatsWrong: "These product images have no alt text.",
        whyItMatters:
          "Alt text describes the image to screen readers and to systems that read your page as text.",
        fix: "Add a short description of what each image shows in the product's media editor.",
        sources: [SOURCES.alt],
        productFilter: "missingAlt",
      }),
    );
  }

  const noVendor = n - catalog.withVendor;
  if (noVendor > 0) {
    issues.push(
      issue({
        key: "catalog.vendor",
        area: "catalog",
        title: `${plural(noVendor, "product")} have no brand`,
        description: "The vendor field becomes the brand in product markup",
        affects: plural(noVendor, "product"),
        count: noVendor,
        impact: "low",
        fixType: "Manual",
        action: { kind: "link", href: ADMIN.products, label: "Open products" },
        whatsWrong: "The vendor field is empty on these products.",
        whyItMatters:
          "Shopify uses the vendor as the brand. Shoppers often ask for products by brand.",
        fix: "Set the vendor on each product, or with the bulk editor.",
        sources: [SOURCES.productSchema],
        productFilter: "noVendor",
      }),
    );
  }
  return issues;
}

function schemaIssues({ audit, embedEnabled, store }) {
  const schema = audit?.schema;
  if (!schema || schema.status === "unknown") return [];
  const issues = [];
  const fields = Object.fromEntries(
    (schema.fields ?? []).map((item) => [item.key, item]),
  );
  const pages = schema.scanned ?? 0;
  const embedAction = {
    kind: "apply",
    area: "schema",
    label: "Turn on product schema",
  };

  if (store?.schemaStatus === "applied" && embedEnabled === false) {
    issues.push(
      issue({
        key: "schema.embed",
        area: "schema",
        title: "GEO's schema app embed is switched off",
        description: "Your theme isn't outputting GEO's product markup",
        affects: "All product pages",
        count: WHOLE_STORE,
        impact: "high",
        fixType: "Guided",
        action: {
          kind: "link",
          href: "/app/access/schema",
          label: "Switch on",
        },
        whatsWrong:
          "Product schema settings are saved, but the GEO app embed is off in your live theme.",
        whyItMatters: "Without the embed, none of the markup GEO prepares is on your pages.",
        fix: "Turn on the GEO schema app embed in the theme editor.",
        sources: [SOURCES.productSchema],
      }),
    );
  }

  const fieldIssue = (key, title, impact, description) => {
    const item = fields[key];
    if (!item || item.status === "ok" || item.status === "info") return;
    issues.push(
      issue({
        key: `schema.${key}`,
        area: "schema",
        title,
        description: description ?? item.detail,
        affects: `${plural(item.total - item.count, "product page")} of ${pages} checked`,
        count: item.total - item.count,
        impact,
        fixType: "App fix",
        action: embedAction,
        whatsWrong: `${item.label}: ${item.detail.toLowerCase()} in the product markup on the pages checked.`,
        whyItMatters:
          "Product markup gives crawlers exact prices, stock and policies instead of leaving them to guess from page text.",
        fix: "GEO's app embed outputs complete Product markup from your live catalog, so it stays correct when prices change.",
        sources: [SOURCES.productSchema],
      }),
    );
  };

  fieldIssue(
    "core",
    "Product markup is missing name, price or availability",
    "high",
  );
  fieldIssue(
    "price",
    "Prices in product markup don't match your store",
    "high",
  );
  fieldIssue(
    "shipping",
    "Product markup has no shipping or return details",
    "medium",
  );
  fieldIssue("brand", "Product markup has no brand", "low");
  fieldIssue("rating", "Reviews in your store aren't in product markup", "low");

  if (fields.organization && fields.organization.status !== "ok") {
    issues.push(
      issue({
        key: "schema.organization",
        area: "schema",
        title: "Home page has no Organization markup",
        description: "Documented for Google; effect on AI answers unproven",
        affects: "Store",
        count: 1,
        impact: "low",
        evidence: "hypothesis",
        fixType: "App fix",
        action: embedAction,
        whatsWrong:
          "Your home page doesn't describe the store as an Organization in structured data.",
        whyItMatters:
          "Organization markup names your brand, logo and contact details in one place.",
        fix: "GEO's app embed adds Organization markup to the home page.",
        sources: [SOURCES.productSchema],
      }),
    );
  }

  if (schema.duplicatePages > 0) {
    issues.push(
      issue({
        key: "schema.duplicates",
        area: "schema",
        title: "Product pages output more than one Product markup",
        description: "Theme and an app may both output JSON-LD",
        affects: `${plural(schema.duplicatePages, "product page")} of ${pages} checked`,
        count: schema.duplicatePages,
        impact: "medium",
        fixType: "Guided",
        action: {
          kind: "link",
          href: "/app/access/schema",
          label: "See markup",
        },
        whatsWrong:
          "These pages contain two or more Product objects. When their prices or stock differ, crawlers can't tell which is right.",
        whyItMatters: "Conflicting markup can be ignored entirely.",
        fix: "Keep one source of product markup: switch off the theme's or the other app's output.",
        sources: [SOURCES.productSchema],
      }),
    );
  }

  if (schema.invalidPages > 0) {
    issues.push(
      issue({
        key: "schema.invalid",
        area: "schema",
        title: "Product markup that can't be read",
        description: "JSON-LD with syntax errors",
        affects: `${plural(schema.invalidPages, "product page")} of ${pages} checked`,
        count: schema.invalidPages,
        impact: "medium",
        fixType: "Guided",
        action: {
          kind: "link",
          href: "/app/access/schema",
          label: "See markup",
        },
        whatsWrong: "A JSON-LD block on these pages isn't valid JSON.",
        whyItMatters: "Crawlers skip markup they can't parse.",
        fix: "Fix the theme snippet or app that outputs it, or let GEO's app embed provide the markup.",
        sources: [SOURCES.productSchema],
      }),
    );
  }
  return issues;
}

function contentIssues({ collections, store }) {
  const issues = [];
  const undescribed = (collections?.total ?? 0) - (collections?.described ?? 0);
  if (undescribed > 0) {
    issues.push(
      issue({
        key: "content.collections",
        area: "content",
        title: `${plural(undescribed, "collection")} have no description`,
        description: "Collection pages answer “best … for …” questions",
        affects: plural(undescribed, "collection"),
        count: undescribed,
        impact: "low",
        evidence: "hypothesis",
        fixType: "Manual",
        action: {
          kind: "link",
          href: ADMIN.collections,
          label: "Open collections",
        },
        whatsWrong: "These collections have no description.",
        whyItMatters:
          "A short description of who a collection is for gives assistants something to quote for broad questions.",
        fix: "Write two or three sentences per collection: who it's for and what sets it apart.",
        sources: [],
      }),
    );
  }

  if (store && !String(store.description || "").trim()) {
    issues.push(
      issue({
        key: "content.storeDescription",
        area: "content",
        title: "Your store has no description",
        description: "Used in llms.txt and search results",
        affects: "Store",
        count: 1,
        impact: "low",
        evidence: "hypothesis",
        fixType: "Manual",
        action: {
          kind: "link",
          href: ADMIN.preferences,
          label: "Open preferences",
        },
        whatsWrong: "The store meta description is empty.",
        whyItMatters:
          "It is the one-sentence summary of what you sell that tools pick up first.",
        fix: "Add a description under Online Store › Preferences.",
        sources: [],
      }),
    );
  }
  return issues;
}

/** Highest impact first; hypotheses never above documented items of the same impact. */
export function rankIssues(issues) {
  const weak = (item) =>
    item.evidence === "hypothesis" || item.evidence === "experimental" ? 1 : 0;
  return [...issues].sort(
    (a, b) =>
      b.rank - a.rank ||
      weak(a) - weak(b) ||
      b.count - a.count,
  );
}

/**
 * Every open issue for the store, ranked.
 * @param {object} input see getIssueInputs()
 */
export function detectIssues(input) {
  return rankIssues([
    ...crawlIssues(input),
    ...policyIssues(input),
    ...catalogIssues(input),
    ...schemaIssues(input),
    ...contentIssues(input),
  ]);
}

/** Counts for the severity summary. */
export function countByImpact(issues) {
  const counts = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const item of issues) counts[item.impact] += 1;
  return counts;
}

/** Issues are compared to crawlers by purpose; exported for tests. */
export const SEARCH_CRAWLERS = AI_CRAWLERS.filter((crawler) =>
  FIXABLE_CRAWLER_PURPOSES.includes(crawler.purpose),
);

/**
 * Product readiness and AI drafts. Pure functions, safe on the client.
 */
import { SHORT_DESCRIPTION_CHARS } from "./issues";

/** Products drafted in one request from the Products list. */
export const MAX_BULK_DRAFTS = 10;

/** Descriptions at least this long usually carry specs, materials and use. */
export const FULL_DESCRIPTION_CHARS = 400;

const CHECKS = [
  { key: "category", label: "Product category set", weight: 20, pass: (p) => Boolean(p.category) },
  {
    key: "description",
    label: `Description of ${FULL_DESCRIPTION_CHARS}+ characters`,
    weight: 25,
    pass: (p) => p.descriptionChars >= FULL_DESCRIPTION_CHARS,
    partial: (p) => (p.descriptionChars >= SHORT_DESCRIPTION_CHARS ? 0.5 : 0),
  },
  { key: "images", label: "At least one image", weight: 15, pass: (p) => p.imageCount > 0 },
  {
    key: "alt",
    label: "Every image has alt text",
    weight: 10,
    pass: (p) => p.imageCount > 0 && p.imagesMissingAlt === 0,
  },
  { key: "gtin", label: "GTIN or barcode", weight: 15, pass: (p) => p.gtinCount > 0 },
  { key: "vendor", label: "Brand (vendor) set", weight: 5, pass: (p) => Boolean(p.vendor) },
  { key: "reviews", label: "Reviews in product data", weight: 10, pass: (p) => p.ratingCount > 0 },
];

/**
 * @param {object} product Product row (category, descriptionChars, imageCount, ...)
 * @returns {{ score: number, checks: Array<{key,label,passed:boolean}>, gap: string|null }}
 */
export function productReadiness(product) {
  let total = 0;
  let earned = 0;
  const checks = CHECKS.map((check) => {
    const passed = check.pass(product);
    const value = passed ? 1 : (check.partial?.(product) ?? 0);
    total += check.weight;
    earned += check.weight * value;
    return { key: check.key, label: check.label, passed, weight: check.weight };
  });
  const missing = checks
    .filter((check) => !check.passed)
    .sort((a, b) => b.weight - a.weight);
  return {
    score: Math.round((earned / total) * 100),
    checks,
    gap: missing[0]?.label ?? null,
  };
}

export const READINESS_BANDS = [
  { key: "needs", label: "Needs work", min: 0, max: 59, tone: "critical" },
  { key: "fair", label: "Fair", min: 60, max: 79, tone: "warning" },
  { key: "good", label: "Good", min: 80, max: 100, tone: "success" },
];

export function readinessBand(score) {
  return READINESS_BANDS.find((band) => score >= band.min && score <= band.max) ?? READINESS_BANDS[0];
}

// ─── Drafts ───────────────────────────────────────────────────────────────────

export const DRAFT_FIELDS = [
  { key: "title", label: "Title", max: 120 },
  { key: "description", label: "Description", max: 4000 },
  { key: "seoTitle", label: "Search title", max: 70 },
  { key: "seoDescription", label: "Search description", max: 320 },
];

export const DRAFT_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string" },
    description: { type: "string" },
    seoTitle: { type: "string" },
    seoDescription: { type: "string" },
  },
  required: ["title", "description", "seoTitle", "seoDescription"],
  additionalProperties: false,
};

const DRAFT_SYSTEM = `You improve Shopify product data so AI shopping assistants can match the product to shoppers' questions.
Rules:
- Use only facts given in the product data. Never invent materials, sizes, certifications, measurements or claims.
- Title: what the product is, then its most important distinguishing attributes, under 100 characters. Keep the brand or model name the store uses.
- Description: plain text, 80 to 220 words. Start with one sentence saying what it is and who it's for. Then key facts as lines starting with "- ". End with care, fit or what's included only if given.
- Search title: under 60 characters. Search description: under 155 characters, one or two plain sentences.
- No marketing superlatives ("best", "amazing"), no emoji, no HTML.
- If the current text is already good, keep it close to the original.`;

/** The request sent to the merchant's AI tool for one product. */
export function buildDraftRequest(product, { storeName, currency } = {}) {
  const lines = [
    storeName && `Store: ${storeName}`,
    `Current title: ${product.title}`,
    product.vendor && `Brand: ${product.vendor}`,
    product.productType && `Product type: ${product.productType}`,
    product.category && `Category: ${product.category}`,
    product.tags?.length && `Tags: ${product.tags.slice(0, 20).join(", ")}`,
    ...(product.options ?? [])
      .filter((option) => option.name !== "Title")
      .map((option) => `Option ${option.name}: ${option.values.slice(0, 20).join(", ")}`),
    product.priceRange &&
      `Price: ${product.priceRange}${currency ? ` ${currency}` : ""}`,
    `Current description: ${String(product.description || "(none)").slice(0, 2500)}`,
    product.seoTitle && `Current search title: ${product.seoTitle}`,
    product.seoDescription && `Current search description: ${product.seoDescription}`,
  ].filter(Boolean);
  return {
    system: DRAFT_SYSTEM,
    prompt: `${lines.join("\n")}\n\nWrite the improved title, description, search title and search description.`,
    schema: DRAFT_SCHEMA,
  };
}

const clip = (value, max) =>
  String(value ?? "")
    .replace(/\r/g, "")
    .trim()
    .slice(0, max);

/** Validated suggestions, keyed by field. Fields equal to the current value are dropped. */
export function normalizeDraft(result, current) {
  const out = {};
  for (const field of DRAFT_FIELDS) {
    const value = clip(result?.[field.key], field.max);
    if (!value) continue;
    const now = clip(current?.[field.key], field.max);
    if (value.replace(/\s+/g, " ") === now.replace(/\s+/g, " ")) continue;
    out[field.key] = value;
  }
  return out;
}

const escapeHtml = (text) =>
  String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

/**
 * Whether a product's current description has formatting that a published
 * draft would flatten: links, images, tables, headings, numbered lists, embeds.
 * Drafts are plain paragraphs and bullet lists only.
 */
export function hasRichFormatting(html) {
  return /<(a|img|table|iframe|video|h[1-6]|ol|blockquote|figure|picture|script|style)\b/i.test(
    String(html || ""),
  );
}

/** Plain-text description (paragraphs and "- " lines) to simple HTML. */
export function descriptionToHtml(text) {
  const blocks = [];
  let list = null;
  for (const raw of String(text || "").split("\n")) {
    const line = raw.trim();
    if (/^[-•*]\s+/.test(line)) {
      list ??= [];
      list.push(`<li>${escapeHtml(line.replace(/^[-•*]\s+/, ""))}</li>`);
      continue;
    }
    if (list) {
      blocks.push(`<ul>${list.join("")}</ul>`);
      list = null;
    }
    if (line) blocks.push(`<p>${escapeHtml(line)}</p>`);
  }
  if (list) blocks.push(`<ul>${list.join("")}</ul>`);
  return blocks.join("\n");
}

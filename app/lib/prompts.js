/**
 * Prompt suggestions: the questions shoppers ask AI about products like the
 * store's. Builds the request for a connected AI tool, validates its answer,
 * and provides catalog-based suggestions when no tool is connected yet.
 * When the tracked domain is another website (not the store), suggestions
 * are written from that website's home page instead of the catalog.
 * Pure functions.
 */
import { PROMPT_KINDS, TRACK } from "./constants";
import { formatMoney } from "./format";

const SUGGESTED_KINDS = ["category", "product", "brand", "gift", "location"];
export const MAX_PROMPT_LENGTH = 200;

export const SUGGESTIONS_SCHEMA = {
  type: "object",
  properties: {
    prompts: {
      type: "array",
      items: {
        type: "object",
        properties: {
          text: { type: "string" },
          kind: { type: "string", enum: SUGGESTED_KINDS },
          basis: { type: "string" },
        },
        required: ["text", "kind", "basis"],
        additionalProperties: false,
      },
    },
  },
  required: ["prompts"],
  additionalProperties: false,
};

export function countryName(code) {
  if (!code) return null;
  try {
    return new Intl.DisplayNames(["en"], { type: "region" }).of(code) ?? code;
  } catch {
    return code;
  }
}

export function cleanPromptText(text) {
  return String(text ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_PROMPT_LENGTH);
}

const SYSTEM = `You write the questions real shoppers type into AI assistants such as ChatGPT, Perplexity, Gemini and Claude when they are looking for something to buy.
Write natural questions, 6 to 20 words each, the way a shopper would type them.
Only brand questions may name the store. Every other question must be about the products, not the store, so it shows whether AI finds the store on its own.
Return JSON only, matching this shape: {"prompts":[{"text":"...","kind":"category|product|brand|gift|location","basis":"the collection, product or store the question is based on"}]}`;

/**
 * System and user prompt for one suggestion request.
 * @param {{ store: object, domains?: string[], collections: object[], products: object[] }} context
 *   `domains`: the domains being tracked, which the questions are written for
 */
export function buildSuggestionRequest({
  store,
  domains = [],
  collections,
  products,
}) {
  const country = countryName(store.country);
  const website = domains.length ? domains.join(", ") : store.url;
  const lines = [
    `Store: ${store.name}`,
    website && `Website: ${website}`,
    country && `Sells in: ${country}`,
    store.description && `About: ${store.description}`,
    collections.length &&
      `Collections: ${collections.map((collection) => collection.title).join("; ")}`,
    products.length && "Top products:",
    ...products.map((product) =>
      [
        `- ${product.title}`,
        product.minPrice != null &&
          formatMoney(product.minPrice, store.currency),
        product.vendor && `brand ${product.vendor}`,
        product.productType && `type ${product.productType}`,
      ]
        .filter(Boolean)
        .join(", "),
    ),
  ].filter(Boolean);

  return {
    system: SYSTEM,
    prompt: `${lines.join("\n")}

Write ${TRACK.suggestions} questions${domains.length ? ` that ${domains[0]} could answer well` : ""}: 3 category, 3 product, 2 brand, 2 gift and 2 location${country ? ` (for shoppers in ${country})` : ""}.`,
    schema: SUGGESTIONS_SCHEMA,
  };
}

// ─── Prompts for a tracked website that isn't the store ──────────────────────

const SITE_SYSTEM = `You write the questions real shoppers type into AI assistants such as ChatGPT, Perplexity, Gemini and Claude when they are looking for something to buy.
Write natural questions, 6 to 20 words each, the way a shopper would type them.
The questions track whether AI assistants recommend and link to the website described below, so base every question on what that website sells and offers.
Only brand questions may name the website. Every other question must be about the products or the shopper's need, not the website, so it shows whether AI finds the website on its own.
Return JSON only, matching this shape: {"prompts":[{"text":"...","kind":"category|product|brand|gift|location","basis":"the section, product type or website the question is based on"}]}`;

const MAX_SECTIONS = 30;
const MAX_HEADINGS = 12;

// Menu links that are site furniture, not things the website sells.
const UI_LINK =
  /^(log ?in|log ?out|sign ?(in|up|out)|register|(my )?(account|profile|orders?|wish ?list)|wish ?list|cart|bag|basket|checkout|search.*|menu|more|help.*|faq.*|support|contact( us)?|about( us)?|careers?|jobs|press|investors?|terms.*|privacy.*|.*polic(y|ies)|cookies?.*|.*download.*|.*customer (care|service).*|track.*order.*|store locator|find a store|sitemap|advertise.*|become a seller|sell on .*|.*notification.*|skip to .*|home|shop now|shop all|view all|see all|learn more|read more|new customer.*|rewards?|gift cards?|(just )?for (you|me)|recommended.*|.*\bdeals?\b.*|.*\boffers?\b.*|.*\bsale\b.*|new|new in|new arrivals?|trending.*|best ?sellers?|top rated|clearance)$/i;

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

function decodeEntities(text) {
  return String(text ?? "").replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, code) => {
    if (code[0] === "#") {
      const value = code[1] === "x" || code[1] === "X"
        ? parseInt(code.slice(2), 16)
        : parseInt(code.slice(1), 10);
      return Number.isFinite(value) && value > 0 ? String.fromCodePoint(value) : match;
    }
    return ENTITIES[code.toLowerCase()] ?? match;
  });
}

/** Visible text of an HTML fragment, on one line. */
function plainText(html) {
  return decodeEntities(String(html ?? "").replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

/** `<meta>` tags as { name or property: content }, lowercased keys. */
function readMeta(html) {
  const meta = {};
  for (const [tag] of html.matchAll(/<meta\b[^>]*>/gi)) {
    const attrs = {};
    for (const [, name, , double, single] of tag.matchAll(
      /([a-z:_-]+)\s*=\s*("([^"]*)"|'([^']*)')/gi,
    ))
      attrs[name.toLowerCase()] = double ?? single;
    const key = (attrs.name ?? attrs.property ?? "").toLowerCase();
    if (key && attrs.content != null && !(key in meta))
      meta[key] = plainText(attrs.content);
  }
  return meta;
}

/** A likely brand name from a domain: "alpineloop.co.uk" → "Alpineloop". */
export function nameFromDomain(host) {
  const labels = String(host ?? "").split(".");
  const secondLevel = labels.length > 2 && labels.at(-2).length <= 3;
  const label = labels.at(secondLevel ? -3 : -2) ?? String(host ?? "");
  return label.charAt(0).toUpperCase() + label.slice(1);
}

// Two-letter domain endings used worldwide rather than for one country.
const GENERIC_CCTLDS = new Set([
  "ac", "ai", "am", "cc", "co", "eu", "fm", "gg", "gl", "im", "io", "la",
  "ly", "me", "nu", "sh", "so", "st", "to", "tv", "vc", "ws",
]);

/** Country a website serves, from its domain ending or page language. */
function siteCountry(domain, lang) {
  const tld = String(domain).split(".").pop();
  if (/^[a-z]{2}$/.test(tld) && !GENERIC_CCTLDS.has(tld)) {
    const code = tld === "uk" ? "GB" : tld.toUpperCase();
    const name = countryName(code);
    if (name && name !== code) return name;
  }
  const region = /^[a-z]{2,3}[-_]([a-z]{2})$/i.exec(String(lang ?? "").trim())?.[1];
  if (region) {
    const name = countryName(region.toUpperCase());
    if (name && name !== region.toUpperCase()) return name;
  }
  return null;
}

/** A website GEO couldn't read: only its domain is known. */
export function unreadSite(domain) {
  return {
    domain,
    read: false,
    name: nameFromDomain(domain),
    title: "",
    description: "",
    sections: [],
    headings: [],
    country: siteCountry(domain, null),
  };
}

/**
 * What a website's home page says it is and sells: name, title,
 * description, menu sections, headings and country.
 * @param {string} html the home page
 * @param {string} domain
 */
export function summarizeSite(html, domain) {
  const page = String(html ?? "");
  const meta = readMeta(page);
  const siteName = meta["og:site_name"] || meta["application-name"];
  const name = siteName && siteName.length <= 40 ? siteName : nameFromDomain(domain);
  const lowerName = name.toLowerCase();

  const sections = [];
  const seen = new Set();
  for (const [, inner] of page.matchAll(/<a\b[^>]*>([\s\S]*?)<\/a>/gi)) {
    const text = plainText(inner).replace(/[.…]+$/, "").trim();
    const key = text.toLowerCase();
    if (
      text.length < 3 ||
      text.length > 32 ||
      text.split(" ").length > 4 ||
      /[?₹$€£%]|\d{2,}/.test(text) ||
      UI_LINK.test(text) ||
      key.includes(lowerName) ||
      seen.has(key)
    )
      continue;
    seen.add(key);
    sections.push(text);
    if (sections.length >= MAX_SECTIONS) break;
  }

  const headings = [];
  for (const [, inner] of page.matchAll(/<h[1-3]\b[^>]*>([\s\S]*?)<\/h[1-3]>/gi)) {
    const text = plainText(inner);
    if (text.length < 4 || text.length > 100 || headings.includes(text)) continue;
    headings.push(text);
    if (headings.length >= MAX_HEADINGS) break;
  }

  return {
    domain,
    read: true,
    name,
    title: plainText(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(page)?.[1]).slice(0, 200),
    description: (meta.description || meta["og:description"] || "").slice(0, 300),
    sections,
    headings,
    country: siteCountry(domain, /<html\b[^>]*\blang\s*=\s*["']?([a-z_-]+)/i.exec(page)?.[1]),
  };
}

/**
 * System and user prompt for suggestions written for tracked websites that
 * aren't the store (from their home pages, not the store's catalog).
 * @param {{ sites: Array<ReturnType<typeof summarizeSite>> }} input
 */
export function buildSiteSuggestionRequest({ sites }) {
  const blocks = sites.map((site) =>
    [
      `Website: ${site.domain}`,
      `Name: ${site.name}`,
      site.title && `Home page title: ${site.title}`,
      site.description && `About: ${site.description}`,
      site.sections.length && `Menu: ${site.sections.join("; ")}`,
      site.headings.length && `Home page headings: ${site.headings.join("; ")}`,
      site.country && `Serves: ${site.country}`,
      !site.read &&
        `Its home page couldn't be read, so use what you know about ${site.domain}.`,
    ]
      .filter(Boolean)
      .join("\n"),
  );
  const [main] = sites;
  const several = sites.length > 1;
  const names = sites.map((site) => site.name).join(" or ");
  const country = main.country ?? "the country the website mainly serves";

  return {
    system: SITE_SYSTEM,
    prompt: `${blocks.join("\n\n")}

Write ${TRACK.suggestions} questions that ${several ? "these websites" : main.domain} would be a good answer to, based only on what ${several ? "they sell" : "it sells"}: 3 category, 3 product, 2 brand (naming ${names}), 2 gift and 2 location (for shoppers in ${country}).`,
    schema: SUGGESTIONS_SCHEMA,
  };
}

/** Suggestions from a website's menu, used before any AI tool is connected. */
export function siteSuggestions(site) {
  const sections = site.sections.slice(0, 3);
  const main = (sections[0] ?? "products").toLowerCase();
  const items = [
    ...sections.map((section) => ({
      text: `Where is the best place to buy ${section.toLowerCase()} online?`,
      kind: "category",
      basis: section,
    })),
    {
      text: `Is ${site.name} a good place to buy ${main}?`,
      kind: "brand",
      basis: site.name,
    },
    {
      text: `${site.name} reviews: is it legit?`,
      kind: "brand",
      basis: site.name,
    },
    sections[0] && {
      text: `Gift ideas in ${main} for someone who has everything`,
      kind: "gift",
      basis: sections[0],
    },
    site.country && {
      text: `Where can I buy ${main} online in ${site.country}?`,
      kind: "location",
      basis: site.country,
    },
  ].filter(Boolean);
  return normalizeSuggestions({ prompts: items });
}

/** Validates an AI tool's answer: known kinds, sensible length, no duplicates. */
export function normalizeSuggestions(result) {
  const seen = new Set();
  return (Array.isArray(result?.prompts) ? result.prompts : [])
    .map((item) => ({
      text: cleanPromptText(item?.text),
      kind: SUGGESTED_KINDS.includes(item?.kind) ? item.kind : "category",
      basis: cleanPromptText(item?.basis).slice(0, 120) || null,
    }))
    .filter((item) => {
      const key = item.text.toLowerCase();
      if (item.text.length < 8 || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, TRACK.suggestions);
}

/** Suggestions built from the catalog, used before any AI tool is connected. */
export function catalogSuggestions({ store, collections, products }) {
  const country = countryName(store.country);
  const topCollections = collections.slice(0, 3);
  const topProducts = products.slice(0, 3);
  const mainCategory = (topCollections[0]?.title ?? "products").toLowerCase();

  const items = [
    ...topCollections.map((collection) => ({
      text: `What are the best ${collection.title.toLowerCase()} to buy online?`,
      kind: "category",
      basis: collection.title,
    })),
    ...topProducts.map((product) => ({
      text: `Is the ${product.title} worth buying?`,
      kind: "product",
      basis: product.title,
    })),
    {
      text: `Is ${store.name} a good place to buy ${mainCategory}?`,
      kind: "brand",
      basis: store.name,
    },
    {
      text: `${store.name} reviews: is it legit?`,
      kind: "brand",
      basis: store.name,
    },
    topCollections[0] && {
      text: `Gift ideas from ${mainCategory} for someone who has everything`,
      kind: "gift",
      basis: topCollections[0].title,
    },
    country && {
      text: `Where can I buy ${mainCategory} online in ${country}?`,
      kind: "location",
      basis: country,
    },
  ].filter(Boolean);

  return normalizeSuggestions({ prompts: items });
}

export function promptKindLabel(kind) {
  return PROMPT_KINDS[kind] ?? PROMPT_KINDS.custom;
}

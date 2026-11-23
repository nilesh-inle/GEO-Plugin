/**
 * Decides whether an AI answer cites or mentions the store. Pure functions.
 *
 * cited:     a source the answer links to is on the store's domain, or the
 *            answer text contains the domain.
 * mentioned: the answer names the store without necessarily linking to it.
 */

/** Hostname without "www.", lowercased. Accepts URLs or bare domains. */
export function normalizeHost(value) {
  if (!value) return null;
  const text = String(value).trim().toLowerCase();
  try {
    const url = new URL(text.includes("://") ? text : `https://${text}`);
    return url.hostname.replace(/^www\./, "") || null;
  } catch {
    return null;
  }
}

/** The store's own domains: primary domain and myshopify domain. */
export function storeDomains(store, shop) {
  return [...new Set([normalizeHost(store?.url), normalizeHost(shop)])].filter(
    Boolean,
  );
}

export const MAX_TRACK_DOMAINS = 5;

// Letters, digits and hyphens per label, at least one dot, a letter TLD.
const DOMAIN_PATTERN =
  /^(?=.{4,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

/**
 * Parses domains typed by the merchant ("example.com, https://www.shop.com/x").
 * @returns {{ domains: string[], invalid: string[] }}
 */
export function parseDomainList(input) {
  const domains = [];
  const invalid = [];
  for (const entry of String(input ?? "").split(/[\s,;]+/)) {
    if (!entry) continue;
    const host = normalizeHost(entry);
    if (host && DOMAIN_PATTERN.test(host)) {
      if (!domains.includes(host)) domains.push(host);
    } else {
      invalid.push(entry);
    }
  }
  return { domains, invalid };
}

/**
 * Domains whose links count as citations: the merchant's own list when set,
 * otherwise the store's domains.
 * @param {{ url?: string, trackDomains?: string|null }} store Store row
 */
export function trackedDomains(store, shop) {
  try {
    const saved = JSON.parse(store?.trackDomains ?? "null");
    if (Array.isArray(saved) && saved.length) return saved;
  } catch {
    // Fall back to the store's domains.
  }
  return storeDomains(store, shop);
}

/**
 * True when none of the tracked domains is the store's own (or a subdomain
 * either way), e.g. a merchant tracking their main website or a marketplace.
 * Prompts are then written for that website rather than the Shopify catalog.
 */
export function tracksOtherSite(domains, ownDomains) {
  return !domains.some(
    (domain) =>
      matchesDomain(domain, ownDomains) ||
      ownDomains.some((own) => matchesDomain(own, [domain])),
  );
}

export function matchesDomain(host, domains) {
  if (!host) return false;
  return domains.some(
    (domain) => host === domain || host.endsWith(`.${domain}`),
  );
}

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The domain (or a subdomain of it) written in text, not part of a longer name. */
function textHasDomain(text, domain) {
  return new RegExp(
    `(^|[^a-z0-9-])([a-z0-9-]+\\.)*${escapeRegExp(domain)}(?![a-z0-9-]|\\.[a-z0-9])`,
    "i",
  ).test(text);
}

/** The name written in text as a whole word. Exported for competitor matching. */
export function mentionsName(text, name) {
  const brand = String(name ?? "").trim();
  if (brand.length < 3) return false;
  // Letter/number boundaries, so names ending in punctuation still match.
  return new RegExp(
    `(^|[^\\p{L}\\p{N}])${escapeRegExp(brand)}($|[^\\p{L}\\p{N}])`,
    "iu",
  ).test(text);
}

/**
 * @param {{ text: string, sources: { url: string, title?: string }[] }} answer
 * @param {{ domains: string[], brand?: string|string[] }} store brand: the store name and other names it goes by
 */
export function analyzeAnswer(answer, { domains, brand }) {
  const text = String(answer?.text ?? "");
  const sources = answer?.sources ?? [];

  const cited =
    sources.some(
      (source) =>
        matchesDomain(normalizeHost(source.url), domains) ||
        // Gemini links go through a Google redirect; the title holds the domain.
        matchesDomain(normalizeHost(source.title), domains),
    ) || domains.some((domain) => textHasDomain(text, domain));

  const brands = (Array.isArray(brand) ? brand : [brand]).filter(Boolean);
  return {
    cited,
    mentioned: cited || brands.some((name) => mentionsName(text, name)),
  };
}

/** Marks which sources belong to the store, for display. */
export function markStoreSources(sources, domains) {
  return sources.map((source) => ({
    ...source,
    isStore:
      matchesDomain(normalizeHost(source.url), domains) ||
      matchesDomain(normalizeHost(source.title), domains),
  }));
}

/**
 * The site a source points to. Gemini links go through a Google redirect
 * whose title is the domain, so the title is used for those.
 */
export function sourceHost(source) {
  const host = normalizeHost(source?.url);
  if (host && /(^|\.)vertexaisearch\.cloud\.google\.com$/.test(host))
    return normalizeHost(source.title) ?? host;
  return host;
}

/** True for an unresolved Gemini grounding redirect link. */
export function isGoogleRedirect(url) {
  return /(^|\.)vertexaisearch\.cloud\.google\.com$/.test(normalizeHost(url) ?? "");
}

const SITE_TYPES = [
  [/reddit\.com$|quora\.com$|forum|community/, "Forum"],
  [/youtube\.com$|tiktok\.com$|instagram\.com$|pinterest\./, "Video & social"],
  [/amazon\.|ebay\.|walmart\.|etsy\.com$|flipkart\.|target\.com$/, "Marketplace"],
  [/wikipedia\.org$/, "Reference"],
  [/review|wirecutter|rtings|consumerreports|techradar|cnet|tomsguide|gearlab|outdoorgearlab|which\.co\.uk|theverge|wired|bestproducts|goodhousekeeping/, "Review site"],
  [/news|times|post|guardian|bbc\.|cnn\.|forbes|businessinsider|nbc|cbs/, "News & media"],
];

/** A rough label for a cited site, from its host name. */
export function siteType(host) {
  for (const [pattern, label] of SITE_TYPES) if (pattern.test(host)) return label;
  return "Website";
}

/** Store.settings, whether still a JSON string (a Store row) or parsed (toStoreView). */
function readSettings(store) {
  try {
    const settings =
      typeof store?.settings === "string"
        ? JSON.parse(store.settings || "{}")
        : store?.settings;
    return settings && typeof settings === "object" ? settings : {};
  } catch {
    return {};
  }
}

/**
 * The store's name in AI visibility: the one set in settings, or the Shopify
 * store name. Kept apart from Store.name, which every sync overwrites.
 */
export function brandName(store) {
  return readSettings(store).storeName || store?.name || "";
}

/** Names that count as a mention: the store's names plus the merchant's brand terms. */
export function brandTerms(store) {
  const extra = readSettings(store).brandTerms;
  return [
    ...new Set(
      [brandName(store), store?.name, ...(Array.isArray(extra) ? extra : [])].filter(Boolean),
    ),
  ];
}

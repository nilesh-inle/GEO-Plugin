/**
 * Extracts and analyzes JSON-LD structured data from storefront HTML.
 * Pure functions: no network.
 */

const SCRIPT_TAG = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
const JSON_LD_TYPE = /type\s*=\s*["']?application\/ld\+json/i;
const GEO_ATTRIBUTE = /\bdata-geo-schema\b/i;
// Raw line breaks and tabs inside strings are the most common JSON-LD breakage.
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001F]+/g;
const GTIN_KEYS = ["gtin", "gtin8", "gtin12", "gtin13", "gtin14", "isbn"];
const ORGANIZATION_TYPES = [
  "Organization",
  "OnlineStore",
  "OnlineBusiness",
  "Store",
  "LocalBusiness",
  "Corporation",
];

/**
 * @returns {{ blocks: { isGeo: boolean, data: unknown }[], invalid: number }}
 *   `invalid` counts blocks that are not strict JSON. They are still parsed
 *   leniently so their fields can be analyzed.
 */
export function extractJsonLd(html) {
  const blocks = [];
  let invalid = 0;

  for (const [, attributes, body] of String(html || "").matchAll(SCRIPT_TAG)) {
    if (!JSON_LD_TYPE.test(attributes)) continue;
    const isGeo = GEO_ATTRIBUTE.test(attributes);
    const raw = body.trim();
    if (!raw) continue;

    try {
      blocks.push({ isGeo, data: JSON.parse(raw) });
    } catch {
      invalid += 1;
      try {
        blocks.push({
          isGeo,
          data: JSON.parse(raw.replace(CONTROL_CHARS, " ")),
        });
      } catch {
        // Unrecoverable block; counted as invalid.
      }
    }
  }

  return { blocks, invalid };
}

/** Flattens arrays and @graph containers into a list of nodes. */
export function collectNodes(data, output = []) {
  if (Array.isArray(data)) {
    for (const item of data) collectNodes(item, output);
  } else if (data && typeof data === "object") {
    output.push(data);
    if (data["@graph"]) collectNodes(data["@graph"], output);
  }
  return output;
}

const typesOf = (node) =>
  []
    .concat(node?.["@type"] ?? [])
    .map((type) => String(type).replace(/^https?:\/\/schema\.org\//, ""));

const isType = (node, types) =>
  typesOf(node).some((type) => types.includes(type));

const hasText = (value) =>
  typeof value === "string" ? value.trim() !== "" : typeof value === "number";

const toNumber = (value) => {
  if (typeof value === "number") return value;
  if (typeof value !== "string") return Number.NaN;
  return Number.parseFloat(value.replace(/[^0-9.-]/g, ""));
};

function collectOffers(value, output = []) {
  for (const offer of [].concat(value ?? [])) {
    if (!offer || typeof offer !== "object") continue;
    output.push(offer);
    if (offer.offers) collectOffers(offer.offers, output);
  }
  return output;
}

function offerPrices(offers) {
  return offers
    .flatMap((offer) => [
      offer.price,
      offer.lowPrice,
      offer.highPrice,
      offer.priceSpecification?.price,
    ])
    .map(toNumber)
    .filter(Number.isFinite);
}

const EMPTY_PRODUCT_ANALYSIS = {
  hasProduct: false,
  core: false,
  priceMatch: null,
  shipping: false,
  returns: false,
  gtin: false,
  rating: false,
  brand: false,
};

/**
 * Analyzes Product / ProductGroup nodes on a product page.
 * @param {object[]} nodes Output of collectNodes.
 * @param {number[]} storePrices Variant prices from the synced catalog.
 */
export function analyzeProductNodes(nodes, storePrices) {
  const products = nodes.filter((node) =>
    isType(node, ["Product", "ProductGroup"]),
  );
  if (!products.length) return { ...EMPTY_PRODUCT_ANALYSIS };

  const variants = products.flatMap((product) =>
    [].concat(product.hasVariant ?? []),
  );
  const items = [...products, ...variants];
  const offers = items.flatMap((item) => collectOffers(item.offers));
  const prices = offerPrices(offers);

  const name = items.some((item) => hasText(item.name));
  const availability = offers.some((offer) => hasText(offer.availability));

  let priceMatch = null;
  if (prices.length && storePrices.length) {
    priceMatch = prices.every((price) =>
      storePrices.some((storePrice) => Math.abs(storePrice - price) < 0.011),
    );
  }

  return {
    hasProduct: true,
    core: name && prices.length > 0 && availability,
    priceMatch,
    shipping: [...offers, ...items].some((node) => node.shippingDetails),
    returns: [...offers, ...items].some((node) => node.hasMerchantReturnPolicy),
    gtin: [...items, ...offers].some((node) =>
      GTIN_KEYS.some((key) => hasText(node[key])),
    ),
    rating: items.some(
      (item) =>
        item.aggregateRating && item.aggregateRating.ratingValue != null,
    ),
    brand: items.some((item) =>
      typeof item.brand === "string"
        ? hasText(item.brand)
        : hasText(item.brand?.name),
    ),
  };
}

/**
 * Full analysis of one product page.
 * `duplicates` counts Product nodes not written by GEO while GEO's own block is present.
 */
export function analyzeProductPage(html, storePrices) {
  const { blocks, invalid } = extractJsonLd(html);
  const nodes = blocks.flatMap((block) => collectNodes(block.data));
  const geoNodes = blocks
    .filter((block) => block.isGeo)
    .flatMap((block) => collectNodes(block.data));
  const otherNodes = blocks
    .filter((block) => !block.isGeo)
    .flatMap((block) => collectNodes(block.data));

  const geoProduct = geoNodes.some((node) =>
    isType(node, ["Product", "ProductGroup"]),
  );
  const otherProducts = otherNodes.filter((node) =>
    isType(node, ["Product", "ProductGroup"]),
  ).length;

  return {
    ...analyzeProductNodes(nodes, storePrices),
    invalid,
    geo: geoProduct,
    duplicates: geoProduct ? otherProducts : 0,
  };
}

export function analyzeHomePage(html) {
  const { blocks, invalid } = extractJsonLd(html);
  const nodes = blocks.flatMap((block) => collectNodes(block.data));
  return {
    organization: nodes.some((node) => isType(node, ORGANIZATION_TYPES)),
    geo: blocks.some((block) => block.isGeo),
    invalid,
  };
}

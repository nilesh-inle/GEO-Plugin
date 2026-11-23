/**
 * Shipping and returns settings for the schema app embed: defaults,
 * validation of merchant input, and the metafield shape Liquid reads.
 * Pure functions: no network, no database.
 */

const SCHEMA_URL = "https://schema.org/";

export function defaultSchemaSettings(store) {
  return {
    shipping: {
      enabled: true,
      rate: 0,
      countries: [store?.country || "US"],
      handlingMin: 0,
      handlingMax: 1,
      transitMin: 2,
      transitMax: 5,
    },
    returns: { accepted: true, days: 30, fees: "free" },
  };
}

const toInt = (value, fallback, min, max) => {
  const number = Number.parseInt(value, 10);
  return Number.isFinite(number)
    ? Math.min(max, Math.max(min, number))
    : fallback;
};

const toMoney = (value, fallback) => {
  const number = Number.parseFloat(value);
  return Number.isFinite(number) && number >= 0
    ? Math.round(number * 100) / 100
    : fallback;
};

const toCountries = (value, fallback) => {
  const list = String(value ?? "")
    .split(/[\s,]+/)
    .map((code) => code.trim().toUpperCase())
    .filter((code) => /^[A-Z]{2}$/.test(code));
  return list.length ? [...new Set(list)] : fallback;
};

/** Validates form input. Unknown or invalid values fall back to defaults. */
export function normalizeSchemaSettings(input, store) {
  const defaults = defaultSchemaSettings(store);
  const shipping = input?.shipping ?? {};
  const returns = input?.returns ?? {};

  const handlingMin = toInt(
    shipping.handlingMin,
    defaults.shipping.handlingMin,
    0,
    30,
  );
  const transitMin = toInt(
    shipping.transitMin,
    defaults.shipping.transitMin,
    0,
    60,
  );

  return {
    shipping: {
      enabled: shipping.enabled !== false,
      rate: toMoney(shipping.rate, defaults.shipping.rate),
      countries: toCountries(shipping.countries, defaults.shipping.countries),
      handlingMin,
      handlingMax: Math.max(
        handlingMin,
        toInt(shipping.handlingMax, defaults.shipping.handlingMax, 0, 30),
      ),
      transitMin,
      transitMax: Math.max(
        transitMin,
        toInt(shipping.transitMax, defaults.shipping.transitMax, 0, 60),
      ),
    },
    returns: {
      accepted: returns.accepted !== false,
      days: toInt(returns.days, defaults.returns.days, 1, 365),
      fees: returns.fees === "customer" ? "customer" : "free",
    },
  };
}

/** Page types the snippet rules apply to, keyed as the app embed reads them. */
export const SNIPPET_PAGE_TYPES = [
  { key: "product", label: "Products" },
  { key: "collection", label: "Collections" },
  { key: "article", label: "Blog posts" },
  { key: "page", label: "Pages and policies" },
];

/** Allowed values: "" (no rule), "nosnippet", or "max-snippet:N". */
export const SNIPPET_OPTIONS = [
  { value: "", label: "No limit" },
  { value: "max-snippet:320", label: "Up to 320 characters" },
  { value: "max-snippet:160", label: "Up to 160 characters" },
  { value: "nosnippet", label: "Don't quote (nosnippet)" },
];

/** Keeps only known page types and values, so nothing else reaches the theme. */
export function normalizeSnippetRules(input) {
  const allowed = new Set(SNIPPET_OPTIONS.map((option) => option.value));
  const rules = {};
  for (const { key } of SNIPPET_PAGE_TYPES) {
    const value = String(input?.[key] ?? "");
    if (value && allowed.has(value)) rules[key] = value;
  }
  return rules;
}

/** Shape read by extensions/geo-schema (snake_case, schema.org URLs resolved). */
export function toEmbedConfig(settings, store, { schema = true } = {}) {
  const { shipping, returns } = settings;
  const snippets = normalizeSnippetRules(store?.settings?.snippets);
  return {
    enabled: schema,
    product: schema,
    organization: schema,
    snippets: Object.keys(snippets).length ? snippets : null,
    shipping: shipping.enabled
      ? {
          rate: shipping.rate,
          currency: store.currency,
          countries: shipping.countries,
          handling_min: shipping.handlingMin,
          handling_max: shipping.handlingMax,
          transit_min: shipping.transitMin,
          transit_max: shipping.transitMax,
        }
      : null,
    returns: returns.accepted
      ? {
          category: `${SCHEMA_URL}MerchantReturnFiniteReturnWindow`,
          days: returns.days,
          fees: `${SCHEMA_URL}${returns.fees === "free" ? "FreeReturn" : "ReturnFeesCustomerResponsibility"}`,
          method: `${SCHEMA_URL}ReturnByMail`,
          countries: shipping.countries,
        }
      : {
          category: `${SCHEMA_URL}MerchantReturnNotPermitted`,
          countries: shipping.countries,
        },
  };
}

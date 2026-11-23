/**
 * Formatting helpers shared by server and client. Fixed "en-US" locale and
 * UTC so server-rendered output matches hydration.
 */

export function formatMoney(amount, currency) {
  if (amount == null || !Number.isFinite(amount)) return null;
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency || "USD",
    }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency || ""}`.trim();
  }
}

export function formatNumber(value) {
  return new Intl.NumberFormat("en-US").format(value ?? 0);
}

export function formatDateTime(value) {
  if (!value) return "Never";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
    timeZoneName: "short",
  }).format(new Date(value));
}

/** Short date, e.g. "Nov 4". */
export function formatDate(value) {
  if (!value) return "";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(value));
}

export function formatPercent(part, total) {
  if (!total) return "0%";
  return `${Math.round((part / total) * 100)}%`;
}

export function pluralize(count, singular, plural = `${singular}s`) {
  return `${formatNumber(count)} ${count === 1 ? singular : plural}`;
}

/** Collapses whitespace and cuts at a word boundary. */
export function truncateText(text, max = 160) {
  const value = String(text || "")
    .replace(/\s+/g, " ")
    .trim();
  if (value.length <= max) return value;
  const cut = value.lastIndexOf(" ", max);
  return `${value.slice(0, cut > max / 2 ? cut : max).replace(/[\s,.;:]+$/, "")}…`;
}

/** GTIN-8, -12, -13 or -14. Same rule as the app embed's Liquid. */
export function isGtin(barcode) {
  return /^(\d{8}|\d{12,14})$/.test(String(barcode || "").trim());
}

/** Numeric id from a Shopify GID, for admin links. */
export function gidToId(gid) {
  return String(gid || "")
    .split("/")
    .pop();
}

export function parseJson(value, fallback) {
  if (value == null || value === "") return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

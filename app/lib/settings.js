/**
 * Automation switches stored in Store.settings, with their defaults.
 */
import { parseDomainList } from "./citations";

export const AUTOMATIONS = [
  {
    key: "weeklyTracking",
    label: "Weekly AI visibility runs",
    detail: "Asks your selected questions to every connected AI tool once a week.",
    default: true,
  },
  {
    key: "weeklyAudit",
    label: "Weekly store audit",
    detail: "Re-syncs products and re-checks crawl access, llms.txt and schema every 7 days.",
    default: false,
  },
  {
    key: "indexNow",
    label: "Tell Bing when pages change (IndexNow)",
    detail: "Submits product and collection URLs when they change, and after GEO publishes a fix.",
    default: false,
  },
];

export function readAutomations(settings = {}) {
  return Object.fromEntries(
    AUTOMATIONS.map((item) => [item.key, settings[item.key] ?? item.default]),
  );
}

export const MAX_BRAND_TERMS = 5;

/** Brand terms typed by the merchant: comma or newline separated, 3-60 characters each. */
export function parseBrandTerms(input) {
  return [
    ...new Set(
      String(input ?? "")
        .split(/[,\n]/)
        .map((term) => term.trim().replace(/\s+/g, " "))
        .filter((term) => term.length >= 3 && term.length <= 60),
    ),
  ].slice(0, MAX_BRAND_TERMS);
}

const cleanName = (input) => String(input ?? "").trim().replace(/\s+/g, " ");

/**
 * The store name the merchant typed for AI visibility, or null to use the
 * Shopify store name. Names under 3 characters are never matched in answers.
 */
export function parseStoreName(input) {
  const name = cleanName(input);
  if (!name) return null;
  if (name.length < 3 || name.length > 60)
    throw new Error("Store name must be 3 to 60 characters.");
  return name;
}

export const MAX_COMPETITORS = 10;

/**
 * A competitor typed by the merchant. The website is optional: without one,
 * only answers naming the competitor count, not links to it.
 * @returns {{ name: string, domain: string | null }}
 */
export function parseCompetitor({ name, website }) {
  const label = cleanName(name);
  if (label.length < 3 || label.length > 60)
    throw new Error("Competitor name must be 3 to 60 characters.");
  if (!String(website ?? "").trim()) return { name: label, domain: null };
  const { domains, invalid } = parseDomainList(website);
  if (invalid.length || domains.length !== 1)
    throw new Error(`Not a valid website: ${String(website).trim()}`);
  return { name: label, domain: domains[0] };
}

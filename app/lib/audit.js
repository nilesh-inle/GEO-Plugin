/**
 * Turns raw scan results into the audit shown to merchants.
 * Pure functions: no network, no database.
 *
 * Status values: "ok" | "issue" | "warning" | "info" | "unknown".
 */
import { AI_CRAWLERS, FIXABLE_CRAWLER_PURPOSES } from "./constants";
import { checkCrawler, parseRobots } from "./robots";
import { analyzeLlmsContent } from "./llms";

const PRODUCT_FIELD_KEYS = [
  "core",
  "price",
  "shipping",
  "gtin",
  "rating",
  "brand",
];

const pathOf = (url) => {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
};

const statusFrom = (issues, warnings) =>
  issues ? "issue" : warnings ? "warning" : "ok";

export function auditRobots(robots) {
  if (!robots?.text) {
    return {
      status: "unknown",
      issues: 0,
      warnings: 1,
      crawlers: [],
      blocked: [],
      error: robots?.error || "robots.txt could not be read",
    };
  }

  const parsed = parseRobots(robots.text);
  const paths = robots.samplePaths?.length ? robots.samplePaths : ["/"];
  const crawlers = AI_CRAWLERS.map((crawler) => {
    const result = checkCrawler(parsed, crawler.agent, paths);
    return {
      ...crawler,
      allowed: result.allowed,
      rule: result.rule,
      blockedPath: result.blockedPath,
    };
  });
  const blocked = crawlers
    .filter(
      (crawler) =>
        !crawler.allowed && FIXABLE_CRAWLER_PURPOSES.includes(crawler.purpose),
    )
    .map((crawler) => crawler.agent);

  return {
    status: statusFrom(blocked.length, 0),
    issues: blocked.length,
    warnings: 0,
    crawlers,
    blocked,
    hasTemplate: Boolean(robots.template?.exists),
    managed: Boolean(robots.template?.managed),
  };
}

export function auditLlms(llms) {
  const live = llms?.llms;
  if (!live) {
    return {
      status: "unknown",
      issues: 0,
      warnings: 1,
      findings: [{ tone: "warning", text: "llms.txt was not checked" }],
    };
  }

  const redirectedTo = live.redirected ? pathOf(live.finalUrl) : null;
  const served = Boolean(live.ok && !redirectedTo);
  const coverage = analyzeLlmsContent(live.ok ? live.text : "");
  // Shopify serves its own llms.txt, which redirects to the store's agent file.
  // That is a working default, not a problem to fix.
  const shopifyDefault = Boolean(
    live.ok && redirectedTo && /\/agents\.md$/i.test(redirectedTo),
  );
  const findings = [];
  let issues = 0;
  let warnings = 0;

  if (!live.ok) {
    issues += 1;
    findings.push({
      tone: "critical",
      text: `No llms.txt is served at /llms.txt (HTTP ${live.status || "error"})`,
    });
  } else if (shopifyDefault) {
    findings.push({
      tone: "success",
      text: "Shopify's default llms.txt is live and points AI agents to your store's agent file",
    });
  } else if (redirectedTo) {
    issues += 1;
    const empty =
      !coverage.collections && !coverage.products && !coverage.policies;
    findings.push({
      tone: "critical",
      text: empty
        ? `/llms.txt redirects to ${redirectedTo}, which lists no collections, products or policies`
        : `/llms.txt redirects to ${redirectedTo} instead of serving a store summary`,
    });
  } else if (!coverage.collections || !coverage.products) {
    issues += 1;
    const missing = [
      !coverage.collections && "collections",
      !coverage.products && "products",
    ].filter(Boolean);
    findings.push({
      tone: "critical",
      text: `llms.txt doesn't list your ${missing.join(" or ")}`,
    });
  }

  if (served && !coverage.policies) {
    warnings += 1;
    findings.push({
      tone: "warning",
      text: "llms.txt doesn't link your shipping and return policies",
    });
  }

  if (!findings.length) {
    findings.push({
      tone: "success",
      text: `llms.txt lists ${coverage.collections} collections, ${coverage.products} products and ${coverage.policies} policies`,
    });
  }

  return {
    status: statusFrom(issues, warnings),
    issues,
    warnings,
    served,
    redirectedTo,
    shopifyDefault,
    coverage,
    managed: Boolean(llms.template?.managed),
    findings,
  };
}

function field(key, label, count, total, status, detail) {
  return { key, label, count, total, status, detail };
}

export function auditSchema(schema, storefront) {
  if (storefront?.passwordProtected) {
    return {
      status: "unknown",
      issues: 0,
      warnings: 0,
      fields: [],
      note: "Product pages are hidden behind your store password, so their schema can't be checked.",
      embedEnabled: schema?.embedEnabled ?? null,
    };
  }

  const all = schema?.products || [];
  const pages = all.filter((page) => page.ok);
  const n = pages.length;
  const count = (predicate) => pages.filter(predicate).length;
  const missing = (value) => (value === 0 ? "Missing" : `${n - value} missing`);

  const core = count((page) => page.core);
  const priceMismatches = count((page) => page.priceMatch === false);
  const shipping = count((page) => page.shipping && page.returns);
  const gtin = count((page) => page.gtin);
  const gtinNeedsMerchant = count((page) => !page.storeGtin);
  const rating = count((page) => page.rating);
  const ratingInStore = count((page) => page.storeRating);
  const brand = count((page) => page.brand);
  const organization = Boolean(storefront?.home?.organization);

  const fields = [
    field(
      "core",
      "Name, price, availability",
      core,
      n,
      core === n ? "ok" : "issue",
      core === n ? "Correct" : missing(core),
    ),
    field(
      "price",
      "Price matches store",
      n - priceMismatches,
      n,
      priceMismatches ? "issue" : "ok",
      priceMismatches ? `${priceMismatches} out of date` : "Correct",
    ),
    field(
      "shipping",
      "Shipping and return policy",
      shipping,
      n,
      shipping === n ? "ok" : "issue",
      shipping === n ? "Correct" : missing(shipping),
    ),
    field(
      "gtin",
      "GTIN",
      gtin,
      n,
      gtin === n ? "ok" : "warning",
      gtin === n ? "Correct" : missing(gtin),
    ),
    ratingInStore === 0 && rating === 0
      ? field(
          "rating",
          "Reviews and rating",
          0,
          n,
          "info",
          "No reviews in your store",
        )
      : field(
          "rating",
          "Reviews and rating",
          rating,
          n,
          rating >= ratingInStore ? "ok" : "warning",
          rating >= ratingInStore ? "Correct" : missing(rating),
        ),
    field(
      "brand",
      "Brand",
      brand,
      n,
      brand === n ? "ok" : "warning",
      brand === n ? "Correct" : missing(brand),
    ),
    field(
      "organization",
      "Organization (store info)",
      organization ? 1 : 0,
      1,
      organization ? "ok" : "warning",
      organization ? "Correct" : "Missing",
    ),
  ];

  if (n === 0) {
    return {
      status: "unknown",
      issues: 0,
      warnings: 1,
      fields: [],
      note: all.length
        ? "Product pages could not be loaded."
        : "No published products to check.",
      embedEnabled: schema?.embedEnabled ?? null,
    };
  }

  const invalidPages = count((page) => page.invalid > 0);
  const duplicatePages = count((page) => page.duplicates > 0);
  const issues =
    fields.filter((item) => item.status === "issue").length +
    (invalidPages ? 1 : 0);
  const warnings =
    fields.filter((item) => item.status === "warning").length +
    (duplicatePages ? 1 : 0);

  return {
    status: statusFrom(issues, warnings),
    issues,
    warnings,
    fields,
    scanned: n,
    total: schema.total ?? n,
    failedPages: all.length - n,
    invalidPages,
    duplicatePages,
    gtinNeedsMerchant,
    ratingInStore,
    embedEnabled: schema.embedEnabled ?? null,
  };
}

/** @param {object} scan Output of the scan (see app/services/scan.server.js). */
export function buildAudit(scan) {
  const passwordProtected = Boolean(scan.storefront?.passwordProtected);
  const robots = auditRobots(scan.robots);
  const llms = auditLlms(scan.llms);
  const schema = auditSchema(scan.schema, scan.storefront);

  return {
    passwordProtected,
    storefrontUrl: scan.storefront?.url ?? null,
    robots,
    llms,
    schema,
    totals: {
      issues:
        robots.issues +
        llms.issues +
        schema.issues +
        (passwordProtected ? 1 : 0),
      warnings: robots.warnings + llms.warnings + schema.warnings,
    },
  };
}

/** Short before/after descriptions for the summary table. */
export function summarizeAudit(audit) {
  if (!audit) return null;
  const { robots, llms, schema } = audit;

  const productFields = (schema.fields || []).filter(
    (item) => PRODUCT_FIELD_KEYS.includes(item.key) && item.status !== "info",
  );
  const complete = productFields.filter((item) => item.status === "ok").length;
  const price = (schema.fields || []).find((item) => item.key === "price");

  const blockedNames = (robots.crawlers || [])
    .filter((crawler) => robots.blocked?.includes(crawler.agent))
    .map((crawler) => crawler.agent);

  let llmsText = "Missing";
  if (llms.shopifyDefault) llmsText = "Shopify default";
  else if (llms.redirectedTo) llmsText = "Redirected";
  else if (llms.served)
    llmsText = `Live, ${llms.coverage.collections} collections, ${llms.coverage.products} products`;

  return {
    robots: {
      ok: robots.status === "ok",
      text:
        robots.status === "unknown"
          ? "Not checked"
          : blockedNames.length
            ? `${blockedNames.join(", ")} blocked`
            : "All AI search crawlers allowed",
    },
    llms: { ok: llms.status === "ok", text: llmsText },
    schema: {
      ok: productFields.length > 0 && complete === productFields.length,
      text: productFields.length
        ? `${complete} of ${productFields.length} fields`
        : "Not checked",
    },
    prices: {
      ok: price?.status === "ok",
      text: !price
        ? "Not checked"
        : price.status === "ok"
          ? "All correct"
          : price.detail,
    },
  };
}

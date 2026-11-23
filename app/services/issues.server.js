/**
 * Fix list and readiness: gathers catalog counts and the latest audit, then
 * runs the pure detectors in app/lib/issues.js and app/lib/readiness.js.
 */
import prisma from "../db.server";
import {
  AREAS,
  SHORT_DESCRIPTION_CHARS,
  countByImpact,
  detectIssues,
} from "../lib/issues";
import { channelChecks, computeReadiness } from "../lib/readiness";
import { getStore, toStoreView } from "./store.server";
import { getLatestAudit } from "./sync.server";

/** shopFacts.version written by catalog sync once products carry category and image data. */
export const CATALOG_FACTS_VERSION = 2;

const ACTIVE = { status: "ACTIVE", isGiftCard: false };

async function catalogCounts(shop) {
  const where = { shop, ...ACTIVE };
  const [
    products,
    withCategory,
    longDescriptions,
    withImages,
    withGtin,
    withVendor,
    images,
    giftCards,
  ] = await Promise.all([
    prisma.product.count({ where }),
    prisma.product.count({ where: { ...where, category: { not: null } } }),
    prisma.product.count({
      where: { ...where, descriptionChars: { gte: SHORT_DESCRIPTION_CHARS } },
    }),
    prisma.product.count({ where: { ...where, imageCount: { gt: 0 } } }),
    prisma.product.count({ where: { ...where, gtinCount: { gt: 0 } } }),
    prisma.product.count({ where: { ...where, vendor: { not: null } } }),
    prisma.product.aggregate({
      where,
      _sum: { imageCount: true, imagesMissingAlt: true },
    }),
    prisma.product.count({ where: { shop, isGiftCard: true } }),
  ]);
  const imageTotal = images._sum.imageCount ?? 0;
  return {
    products,
    withCategory,
    longDescriptions,
    withImages,
    withGtin,
    withVendor,
    images: imageTotal,
    imagesWithAlt: imageTotal - (images._sum.imagesMissingAlt ?? 0),
    giftCards,
  };
}

async function collectionCounts(shop) {
  const [total, described] = await Promise.all([
    prisma.collection.count({ where: { shop } }),
    prisma.collection.count({
      where: { shop, description: { not: null } },
    }),
  ]);
  return { total, described };
}

/**
 * Everything the detectors read. Catalog fields added after a store's last
 * sync are reported as stale instead of as issues.
 */
export async function getIssueInputs(shop, { audit } = {}) {
  const [storeRow, latestAudit, catalog, collections, brandFacts] =
    await Promise.all([
      getStore(shop),
      audit ? null : getLatestAudit(shop),
      catalogCounts(shop),
      collectionCounts(shop),
      prisma.brandFact.count({ where: { shop } }),
    ]);
  const store = toStoreView(storeRow);
  const currentAudit = audit ?? latestAudit;
  const stale = (store?.shopFacts?.version ?? 0) < CATALOG_FACTS_VERSION;

  return {
    audit: currentAudit,
    store,
    shopFacts: stale ? null : store?.shopFacts,
    catalog: stale
      ? {
          // Only fields the previous sync already stored.
          products: catalog.products,
          withGtin: catalog.withGtin,
          withVendor: catalog.withVendor,
          withCategory: catalog.products,
          longDescriptions: catalog.products,
          withImages: catalog.products,
          images: 0,
          imagesWithAlt: 0,
        }
      : catalog,
    collections,
    brandFacts,
    embedEnabled: currentAudit?.schema?.embedEnabled ?? null,
    stale,
  };
}

/** Readiness for an audit that was just created (stored on the Audit row). */
export async function readinessFor(shop, audit) {
  const input = await getIssueInputs(shop, { audit });
  return computeReadiness(input).score;
}

/** The Fix list: open issues, dismissed issues and summary counts. */
export async function getFixList(shop) {
  const [input, states] = await Promise.all([
    getIssueInputs(shop),
    prisma.issueState.findMany({ where: { shop } }),
  ]);
  const dismissed = new Set(
    states.filter((row) => row.status === "dismissed").map((row) => row.key),
  );
  const all = detectIssues(input);
  const open = all.filter((item) => !dismissed.has(item.key));

  return {
    auditedAt: input.audit?.createdAt ?? null,
    stale: input.stale,
    open,
    dismissed: all.filter((item) => dismissed.has(item.key)),
    counts: countByImpact(open),
    appFixable: open.filter((item) => item.fixType === "App fix").length,
    areas: Object.entries(AREAS).map(([key, label]) => ({
      key,
      label,
      count: open.filter((item) => item.area === key).length,
    })),
    readiness: computeReadiness(input),
    channels: channelChecks(input),
    catalog: input.catalog,
    embedEnabled: input.embedEnabled,
  };
}

export async function setIssueStatus(shop, key, status) {
  return prisma.issueState.upsert({
    where: { shop_key: { shop, key } },
    create: { shop, key, status },
    update: { status },
  });
}

const PRODUCT_FILTERS = {
  noCategory: { category: null },
  thin: { descriptionChars: { lt: SHORT_DESCRIPTION_CHARS } },
  noGtin: { gtinCount: 0 },
  noImages: { imageCount: 0 },
  missingAlt: { imagesMissingAlt: { gt: 0 } },
  noVendor: { vendor: null },
};

/** Products matching a Fix list filter, for issue detail and the Products page. */
export function findProducts(shop, filter, { take = 50, skip = 0 } = {}) {
  return prisma.product.findMany({
    where: { shop, ...ACTIVE, ...(PRODUCT_FILTERS[filter] ?? {}) },
    orderBy: { title: "asc" },
    take,
    skip,
    select: {
      id: true,
      title: true,
      handle: true,
      imageUrl: true,
      productType: true,
      vendor: true,
      category: true,
      descriptionChars: true,
      imageCount: true,
      imagesMissingAlt: true,
      gtinCount: true,
      variantCount: true,
    },
  });
}

/** One issue with the products it affects. Null when it's no longer detected. */
export async function getIssue(shop, key) {
  const list = await getFixList(shop);
  const found =
    list.open.find((item) => item.key === key) ??
    list.dismissed.find((item) => item.key === key);
  if (!found) return null;
  const products = found.productFilter
    ? await findProducts(shop, found.productFilter, { take: 100 })
    : [];
  return {
    issue: found,
    dismissed: list.dismissed.some((item) => item.key === key),
    products,
    auditedAt: list.auditedAt,
  };
}

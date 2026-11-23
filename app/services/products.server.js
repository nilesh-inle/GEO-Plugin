/**
 * Products: per-product readiness, AI drafts for title, description and SEO
 * fields, and publishing the drafts the merchant accepts (write_products).
 */
import prisma from "../db.server";
import { assertNoUserErrors, gql } from "./admin.server";
import { refreshProduct } from "./catalog.server";
import { ACTOR, recordChange } from "./changes.server";
import { submitChanged } from "./indexnow.server";
import { runWithAiTool } from "./tracking.server";
import { SHORT_DESCRIPTION_CHARS } from "../lib/issues";
import {
  DRAFT_FIELDS,
  MAX_BULK_DRAFTS,
  READINESS_BANDS,
  buildDraftRequest,
  descriptionToHtml,
  normalizeDraft,
  productReadiness,
  readinessBand,
} from "../lib/products";

export const PAGE_SIZE = 25;

const toGid = (id) =>
  String(id).startsWith("gid://") ? String(id) : `gid://shopify/Product/${id}`;

export const PRODUCT_VIEWS = [
  { key: "all", label: "All" },
  { key: "needs", label: "Needs work" },
  { key: "thin", label: "Thin descriptions" },
  { key: "noCategory", label: "No category" },
  { key: "drafts", label: "With drafts" },
];

const LIST_SELECT = {
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
  ratingCount: true,
  variantCount: true,
  minPrice: true,
};

/** Paged product list with readiness, plus the store-wide distribution. */
export async function listProducts(shop, { view = "all", q = "", page = 1 } = {}) {
  const [rows, draftGroups] = await Promise.all([
    prisma.product.findMany({
      where: { shop, status: "ACTIVE", isGiftCard: false },
      select: LIST_SELECT,
      orderBy: { title: "asc" },
    }),
    prisma.productDraft.groupBy({
      by: ["productId"],
      where: { shop, status: { in: ["draft", "accepted"] } },
      _count: { _all: true },
    }),
  ]);
  const drafts = new Map(draftGroups.map((row) => [row.productId, row._count._all]));
  const scored = rows.map((row) => {
    const readiness = productReadiness(row);
    return { ...row, score: readiness.score, gap: readiness.gap, drafts: drafts.get(row.id) ?? 0 };
  });

  const distribution = READINESS_BANDS.map((band) => ({
    ...band,
    count: scored.filter((row) => readinessBand(row.score).key === band.key).length,
  }));
  const filters = {
    all: () => true,
    needs: (row) => row.score < 60,
    thin: (row) => row.descriptionChars < SHORT_DESCRIPTION_CHARS,
    noCategory: (row) => !row.category,
    drafts: (row) => row.drafts > 0,
  };
  const needle = q.trim().toLowerCase();
  const filtered = scored
    .filter(filters[view] ?? filters.all)
    .filter(
      (row) =>
        !needle ||
        `${row.title} ${row.vendor ?? ""} ${row.productType ?? ""}`
          .toLowerCase()
          .includes(needle),
    )
    .sort((a, b) => a.score - b.score || a.title.localeCompare(b.title));

  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const current = Math.min(Math.max(1, page), pages);
  return {
    total: scored.length,
    matching: filtered.length,
    page: current,
    pages,
    rows: filtered.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE),
    distribution,
    views: PRODUCT_VIEWS.map((item) => ({
      ...item,
      count: scored.filter(filters[item.key]).length,
    })),
    average: scored.length
      ? Math.round(scored.reduce((sum, row) => sum + row.score, 0) / scored.length)
      : null,
  };
}

const PRODUCT_QUERY = `#graphql
  query GeoProductWorkspace($id: ID!) {
    product(id: $id) {
      id
      title
      handle
      status
      vendor
      productType
      tags
      onlineStoreUrl
      description(truncateAt: 2500)
      descriptionHtml
      seo {
        title
        description
      }
      category {
        fullName
      }
      options {
        name
        optionValues {
          name
        }
      }
      priceRangeV2 {
        minVariantPrice {
          amount
          currencyCode
        }
        maxVariantPrice {
          amount
          currencyCode
        }
      }
      variantsCount {
        count
      }
      featuredMedia {
        preview {
          image {
            url
          }
        }
      }
    }
  }`;

/** The product as Shopify has it now, in the shape drafts and the workspace use. */
export async function readLiveProduct(admin, id) {
  const data = await gql(admin, PRODUCT_QUERY, { id: toGid(id) });
  const product = data.product;
  if (!product) return null;
  const min = product.priceRangeV2?.minVariantPrice;
  const max = product.priceRangeV2?.maxVariantPrice;
  return {
    id: product.id,
    title: product.title,
    handle: product.handle,
    status: product.status,
    vendor: product.vendor || null,
    productType: product.productType || null,
    tags: product.tags ?? [],
    url: product.onlineStoreUrl,
    description: product.description ?? "",
    descriptionHtml: product.descriptionHtml ?? "",
    seoTitle: product.seo?.title ?? "",
    seoDescription: product.seo?.description ?? "",
    category: product.category?.fullName ?? null,
    options: (product.options ?? []).map((option) => ({
      name: option.name,
      values: (option.optionValues ?? []).map((value) => value.name),
    })),
    priceRange:
      min && max
        ? min.amount === max.amount
          ? min.amount
          : `${min.amount}–${max.amount}`
        : null,
    currency: min?.currencyCode ?? null,
    variants: product.variantsCount?.count ?? 0,
    imageUrl: product.featuredMedia?.preview?.image?.url ?? null,
  };
}

/** Everything the product workspace shows. */
export async function getProductWorkspace(admin, shop, id) {
  const gid = toGid(id);
  const [live, row, drafts, history] = await Promise.all([
    readLiveProduct(admin, gid),
    prisma.product.findFirst({ where: { shop, id: gid } }),
    prisma.productDraft.findMany({
      where: { shop, productId: gid, status: { in: ["draft", "accepted", "rejected"] } },
      orderBy: { createdAt: "asc" },
    }),
    prisma.changeLog.findMany({
      where: { shop, area: "products", detail: { contains: gid } },
      orderBy: { createdAt: "desc" },
      take: 5,
    }),
  ]);
  if (!live) return null;
  return {
    product: live,
    readiness: row ? productReadiness(row) : null,
    stats: row
      ? {
          descriptionChars: row.descriptionChars,
          imageCount: row.imageCount,
          imagesMissingAlt: row.imagesMissingAlt,
          gtinCount: row.gtinCount,
          variantCount: row.variantCount,
          ratingCount: row.ratingCount,
        }
      : null,
    drafts: drafts.map((draft) => ({
      id: draft.id,
      field: draft.field,
      current: draft.current,
      suggested: draft.suggested,
      status: draft.status,
    })),
    history: history.map((item) => ({
      id: item.id,
      title: item.title,
      status: item.status,
      createdAt: item.createdAt,
    })),
  };
}

const currentValues = (live) => ({
  title: live.title,
  description: live.description,
  seoTitle: live.seoTitle,
  seoDescription: live.seoDescription,
});

/** Writes AI suggestions for one product with the merchant's AI tool. */
export async function generateDrafts(admin, shop, id, store) {
  const live = await readLiveProduct(admin, toGid(id));
  if (!live) throw new Error("This product no longer exists.");
  const { result } = await runWithAiTool(
    shop,
    (adapter, tool) =>
      adapter.generateJson(
        tool.apiKey,
        tool.model,
        buildDraftRequest(live, { storeName: store?.name, currency: live.currency }),
      ),
    { label: "Writing product drafts" },
  );
  const current = currentValues(live);
  const draft = normalizeDraft(result, current);
  await prisma.$transaction([
    prisma.productDraft.deleteMany({
      where: { shop, productId: live.id, status: { in: ["draft", "accepted", "rejected"] } },
    }),
    prisma.productDraft.createMany({
      data: Object.entries(draft).map(([field, suggested]) => ({
        shop,
        productId: live.id,
        field,
        current: current[field] ?? "",
        suggested,
      })),
    }),
  ]);
  return Object.keys(draft).length;
}

/** Drafts several products in turn. Stops early if the AI tool fails. */
export async function generateDraftsFor(admin, shop, ids, store) {
  let products = 0;
  let fields = 0;
  for (const id of ids.slice(0, MAX_BULK_DRAFTS)) {
    fields += await generateDrafts(admin, shop, id, store);
    products += 1;
  }
  return { products, fields };
}

export async function updateDraft(shop, draftId, { status, suggested }) {
  const draft = await prisma.productDraft.findFirst({ where: { shop, id: draftId } });
  if (!draft) throw new Error("That draft no longer exists.");
  const field = DRAFT_FIELDS.find((item) => item.key === draft.field);
  const data = {};
  if (["draft", "accepted", "rejected"].includes(status)) data.status = status;
  if (suggested != null) {
    const text = String(suggested).trim().slice(0, field?.max ?? 4000);
    if (!text) throw new Error("The suggestion can't be empty.");
    data.suggested = text;
  }
  return prisma.productDraft.update({ where: { id: draft.id }, data });
}

/**
 * Publishes accepted drafts for one product. The product's current values
 * are saved in change history first, so the change can be restored.
 */
export async function publishDrafts(admin, shop, id) {
  const gid = toGid(id);
  const accepted = await prisma.productDraft.findMany({
    where: { shop, productId: gid, status: "accepted" },
  });
  if (!accepted.length) throw new Error("Accept at least one suggestion first.");
  const live = await readLiveProduct(admin, gid);
  if (!live) throw new Error("This product no longer exists.");

  const input = { id: gid };
  const values = Object.fromEntries(accepted.map((draft) => [draft.field, draft.suggested]));
  if (values.title) input.title = values.title;
  if (values.description) input.descriptionHtml = descriptionToHtml(values.description);
  if (values.seoTitle || values.seoDescription)
    input.seo = {
      ...(values.seoTitle ? { title: values.seoTitle } : {}),
      ...(values.seoDescription ? { description: values.seoDescription } : {}),
    };

  try {
    const data = await gql(
      admin,
      `#graphql
      mutation GeoPublishProductDrafts($product: ProductUpdateInput!) {
        productUpdate(product: $product) {
          product {
            id
          }
          userErrors {
            field
            message
          }
        }
      }`,
      { product: input },
    );
    assertNoUserErrors(data.productUpdate, "Publishing the product");
  } catch (error) {
    await prisma.productDraft.updateMany({
      where: { id: { in: accepted.map((draft) => draft.id) } },
      data: { status: "failed", error: error.message.slice(0, 300) },
    });
    throw error;
  }

  const labels = accepted
    .map((draft) => DRAFT_FIELDS.find((field) => field.key === draft.field)?.label.toLowerCase())
    .filter(Boolean);
  await recordChange(shop, {
    area: "products",
    title: `${live.title}: updated ${labels.join(", ")}`,
    detail: `Product ${gid}`,
    items: 1,
    actor: ACTOR.MERCHANT,
    before: {
      kind: "product",
      productId: gid,
      fields: {
        ...(values.title ? { title: live.title } : {}),
        ...(values.description ? { descriptionHtml: live.descriptionHtml } : {}),
        ...(values.seoTitle ? { seoTitle: live.seoTitle } : {}),
        ...(values.seoDescription ? { seoDescription: live.seoDescription } : {}),
      },
    },
  });
  await prisma.productDraft.updateMany({
    where: { id: { in: accepted.map((draft) => draft.id) } },
    data: { status: "published", error: null },
  });
  await prisma.productDraft.deleteMany({
    where: { shop, productId: gid, status: { in: ["draft", "rejected"] } },
  });
  await refreshProduct(admin, shop, gid).catch((error) =>
    console.error(`[geo] refreshing ${gid} after publish failed`, error),
  );
  await submitChanged(shop, live.url, "Published product changes");
  return accepted.length;
}

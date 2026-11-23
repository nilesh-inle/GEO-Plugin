/**
 * Imports shop details, products and collections into the app database.
 */
import prisma from "../db.server";
import { gql } from "./admin.server";
import { runBulkQuery } from "./bulk.server";
import { upsertStore } from "./store.server";
import { isGtin, truncateText } from "../lib/format";
import { findReturnWindow } from "../lib/policies";

// Not tagged #graphql: bulk queries are passed as a string variable. The same
// fields are validated by GeoProduct below.
const PRODUCTS_BULK_QUERY = `{
  products(query: "status:active") {
    edges {
      node {
        id
        handle
        title
        status
        vendor
        productType
        updatedAt
        onlineStoreUrl
        isGiftCard
        category { fullName }
        description(truncateAt: 2000)
        featuredMedia { preview { image { url } } }
        rating: metafield(namespace: "reviews", key: "rating") { value }
        ratingCount: metafield(namespace: "reviews", key: "rating_count") { value }
        variants { edges { node { id price barcode availableForSale } } }
        media { edges { node { id mediaContentType ... on MediaImage { alt } } } }
      }
    }
  }
}`;

const CHUNK = 200;

function chunk(items, size = CHUNK) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size)
    chunks.push(items.slice(index, index + size));
  return chunks;
}

/** Rating metafields store JSON like {"value":"4.6","scale_min":"1.0","scale_max":"5.0"}. */
function parseRating(value) {
  if (!value) return null;
  try {
    const rating = Number.parseFloat(JSON.parse(value).value);
    return Number.isFinite(rating) ? rating : null;
  } catch {
    return null;
  }
}

const isVariant = (row) => String(row.id).includes("/ProductVariant/");

function imageStats(media) {
  const images = media.filter((item) => item.mediaContentType === "IMAGE");
  return {
    imageCount: images.length,
    imagesMissingAlt: images.filter((image) => !String(image.alt || "").trim())
      .length,
  };
}

function mapProduct(shop, node, variants, media = []) {
  const prices = [
    ...new Set(
      variants
        .map((variant) => Number.parseFloat(variant.price))
        .filter(Number.isFinite),
    ),
  ].sort((a, b) => a - b);

  return {
    id: node.id,
    shop,
    handle: node.handle,
    title: node.title,
    status: node.status,
    vendor: node.vendor || null,
    productType: node.productType || null,
    description: truncateText(node.description, 500) || null,
    descriptionChars: String(node.description || "").trim().length,
    category: node.category?.fullName || null,
    isGiftCard: Boolean(node.isGiftCard),
    ...imageStats(media),
    url: node.onlineStoreUrl || null,
    imageUrl: node.featuredMedia?.preview?.image?.url || null,
    minPrice: prices[0] ?? null,
    maxPrice: prices.at(-1) ?? null,
    prices: JSON.stringify(prices),
    available: variants.some((variant) => variant.availableForSale),
    variantCount: variants.length,
    gtinCount: variants.filter((variant) => isGtin(variant.barcode)).length,
    ratingValue: parseRating(node.rating?.value),
    ratingCount: Number.parseInt(node.ratingCount?.value, 10) || 0,
    updatedAt: new Date(node.updatedAt),
  };
}

function mapCollection(shop, node) {
  return {
    id: node.id,
    shop,
    handle: node.handle,
    title: node.title,
    description: truncateText(node.description, 300) || null,
    productsCount: node.productsCount?.count ?? 0,
    updatedAt: new Date(node.updatedAt),
  };
}

/** Shop details and policies. Creates the Store row on first sync. */
export async function syncShopInfo(admin, shop) {
  const data = await gql(
    admin,
    `#graphql
    query GeoShopInfo {
      shop {
        name
        description
        contactEmail
        currencyCode
        url
        billingAddress {
          countryCodeV2
        }
        shipsToCountries
        shopPolicies {
          type
          title
          url
          body
        }
      }
      currentAppInstallation {
        id
      }
    }`,
  );

  const info = data.shop;
  const policies = (info.shopPolicies ?? [])
    .filter((policy) => policy.body?.trim())
    .map(({ type, title, url }) => ({ type, title, url }));

  const refund = (info.shopPolicies ?? []).find(
    (policy) => policy.type === "REFUND_POLICY",
  );
  const shopFacts = {
    // Matches CATALOG_FACTS_VERSION in issues.server.js.
    version: 2,
    shipsTo: info.shipsToCountries ?? [],
    policyTypes: policies.map((policy) => policy.type),
    refundWindowDays: findReturnWindow(refund?.body),
  };

  return upsertStore(shop, {
    name: info.name,
    shopFacts: JSON.stringify(shopFacts),
    description: info.description || null,
    contactEmail: info.contactEmail || null,
    currency: info.currencyCode,
    url: info.url.replace(/\/$/, ""),
    country: info.billingAddress?.countryCodeV2 || null,
    policies: JSON.stringify(policies),
    appInstallationId: data.currentAppInstallation?.id ?? null,
  });
}

/** Full product export through a bulk operation. Replaces the shop's product rows. */
export async function syncProducts(admin, shop) {
  const rows = await runBulkQuery(admin, PRODUCTS_BULK_QUERY);
  const nodes = [];
  const variantsByProduct = new Map();
  const mediaByProduct = new Map();
  const add = (map, key, row) => {
    if (map.has(key)) map.get(key).push(row);
    else map.set(key, [row]);
  };

  for (const row of rows) {
    if (!row.__parentId) nodes.push(row);
    else if (isVariant(row)) add(variantsByProduct, row.__parentId, row);
    else add(mediaByProduct, row.__parentId, row);
  }

  const products = nodes.map((node) =>
    mapProduct(
      shop,
      node,
      variantsByProduct.get(node.id) ?? [],
      mediaByProduct.get(node.id) ?? [],
    ),
  );
  await prisma.$transaction([
    prisma.product.deleteMany({ where: { shop } }),
    ...chunk(products).map((data) => prisma.product.createMany({ data })),
  ]);
  return products.length;
}

export async function syncCollections(admin, shop) {
  const collections = [];
  let after = null;

  do {
    const data = await gql(
      admin,
      `#graphql
      query GeoCollections($after: String) {
        collections(first: 100, after: $after) {
          nodes {
            id
            handle
            title
            updatedAt
            description(truncateAt: 300)
            productsCount {
              count
            }
          }
          pageInfo {
            hasNextPage
            endCursor
          }
        }
      }`,
      { after },
    );
    collections.push(
      ...data.collections.nodes.map((node) => mapCollection(shop, node)),
    );
    after = data.collections.pageInfo.hasNextPage
      ? data.collections.pageInfo.endCursor
      : null;
  } while (after);

  await prisma.$transaction([
    prisma.collection.deleteMany({ where: { shop } }),
    ...chunk(collections).map((data) => prisma.collection.createMany({ data })),
  ]);
  return collections.length;
}

/** Re-reads one product after a webhook. Deletes the row if the product is gone. */
export async function refreshProduct(admin, shop, id) {
  const data = await gql(
    admin,
    `#graphql
    query GeoProduct($id: ID!) {
      product(id: $id) {
        id
        handle
        title
        status
        vendor
        productType
        updatedAt
        onlineStoreUrl
        isGiftCard
        category {
          fullName
        }
        description(truncateAt: 2000)
        featuredMedia {
          preview {
            image {
              url
            }
          }
        }
        media(first: 100) {
          nodes {
            id
            mediaContentType
            ... on MediaImage {
              alt
            }
          }
        }
        rating: metafield(namespace: "reviews", key: "rating") {
          value
        }
        ratingCount: metafield(namespace: "reviews", key: "rating_count") {
          value
        }
        variants(first: 250) {
          nodes {
            id
            price
            barcode
            availableForSale
          }
        }
      }
    }`,
    { id },
  );

  if (!data.product) return removeProduct(shop, id);
  const row = mapProduct(
    shop,
    data.product,
    data.product.variants.nodes,
    data.product.media.nodes,
  );
  return prisma.product.upsert({ where: { id }, create: row, update: row });
}

export async function refreshCollection(admin, shop, id) {
  const data = await gql(
    admin,
    `#graphql
    query GeoCollection($id: ID!) {
      collection(id: $id) {
        id
        handle
        title
        updatedAt
        description(truncateAt: 300)
        productsCount {
          count
        }
      }
    }`,
    { id },
  );

  if (!data.collection) return removeCollection(shop, id);
  const row = mapCollection(shop, data.collection);
  return prisma.collection.upsert({ where: { id }, create: row, update: row });
}

export function removeProduct(shop, id) {
  return prisma.product.deleteMany({ where: { shop, id } });
}

export function removeCollection(shop, id) {
  return prisma.collection.deleteMany({ where: { shop, id } });
}

/** Live store details for the welcome screen. Read-only. */
export async function getStoreOverview(admin) {
  const data = await gql(
    admin,
    `#graphql
    query GeoStoreOverview {
      shop {
        name
        url
        myshopifyDomain
      }
      productsCount {
        count
      }
      collectionsCount {
        count
      }
      themes(first: 1, roles: [MAIN]) {
        nodes {
          name
        }
      }
    }`,
  );
  return {
    name: data.shop.name,
    url: data.shop.url,
    domain: data.shop.myshopifyDomain,
    products: data.productsCount?.count ?? 0,
    collections: data.collectionsCount?.count ?? 0,
    theme: data.themes.nodes[0]?.name ?? null,
  };
}

export async function countCatalog(shop) {
  const [productCount, collectionCount] = await Promise.all([
    prisma.product.count({ where: { shop, status: "ACTIVE" } }),
    prisma.collection.count({ where: { shop } }),
  ]);
  return { productCount, collectionCount };
}

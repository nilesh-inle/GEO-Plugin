/**
 * Data for the Schema markup page: app embed status, field coverage and a
 * preview of the JSON-LD the app embed renders.
 */
import prisma from "../db.server";
import { defaultSchemaSettings, toEmbedConfig } from "../lib/schemaSettings";
import {
  buildOrganizationJsonLd,
  buildProductJsonLd,
} from "../lib/schemaPreview";
import { gql } from "./admin.server";
import { toStoreView } from "./store.server";
import {
  getAppEmbedStatus,
  getEmbedActivationUrl,
  getMainTheme,
} from "./theme.server";

const PUBLISHED = { status: "ACTIVE", url: { not: null } };
const PRODUCT_CHOICES = 50;

const PREVIEW_PRODUCT_QUERY = `#graphql
  query GeoSchemaPreviewProduct($id: ID!) {
    product(id: $id) {
      title
      handle
      description
      vendor
      featuredMedia {
        preview {
          image {
            url
          }
        }
      }
      variants(first: 25) {
        nodes {
          id
          price
          sku
          barcode
          availableForSale
        }
      }
      rating: metafield(namespace: "reviews", key: "rating") {
        value
      }
      ratingCount: metafield(namespace: "reviews", key: "rating_count") {
        value
      }
    }
  }`;

/**
 * @param {string} shop
 * @param {object} storeRow Store row (synced)
 * @param {string|null} requestedProductId product to preview
 */
export async function getSchemaOverview(
  admin,
  shop,
  storeRow,
  requestedProductId,
) {
  const store = toStoreView(storeRow);
  const settings = store.schemaSettings ?? defaultSchemaSettings(store);
  const config = toEmbedConfig(settings, store);

  const theme = await getMainTheme(admin);
  const [embedEnabled, total, withGtin, withRating, withBrand, choices] =
    await Promise.all([
      getAppEmbedStatus(admin, theme.id).catch(() => null),
      prisma.product.count({ where: { shop, ...PUBLISHED } }),
      prisma.product.count({
        where: { shop, ...PUBLISHED, gtinCount: { gt: 0 } },
      }),
      prisma.product.count({
        where: { shop, ...PUBLISHED, ratingCount: { gt: 0 } },
      }),
      prisma.product.count({
        where: { shop, ...PUBLISHED, vendor: { not: null } },
      }),
      prisma.product.findMany({
        where: { shop, ...PUBLISHED },
        select: { id: true, title: true },
        orderBy: { title: "asc" },
        take: PRODUCT_CHOICES,
      }),
    ]);

  const productId = choices.some((choice) => choice.id === requestedProductId)
    ? requestedProductId
    : choices[0]?.id;
  const product = productId
    ? (await gql(admin, PREVIEW_PRODUCT_QUERY, { id: productId })).product
    : null;

  return {
    status: store.schemaStatus,
    message: store.fixState.schema?.message ?? null,
    currency: store.currency,
    settings,
    embed: {
      enabled: embedEnabled,
      activationUrl: getEmbedActivationUrl(shop),
      themeName: theme.name,
    },
    coverage: { total, withGtin, withRating, withBrand },
    shippingOn: Boolean(config.shipping),
    returnsOn: settings.returns.accepted,
    choices,
    productId,
    productJson: product
      ? JSON.stringify(buildProductJsonLd({ product, store, config }), null, 2)
      : null,
    organizationJson: JSON.stringify(
      buildOrganizationJsonLd({ store, config }),
      null,
      2,
    ),
  };
}

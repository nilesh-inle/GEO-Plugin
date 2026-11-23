/**
 * Builds the JSON-LD the geo-schema app embed renders, from Admin API data,
 * so merchants can preview it in the app. Mirrors
 * extensions/geo-schema/snippets/geo-product-schema.liquid and
 * geo-organization-schema.liquid; keep them in sync. Pure functions.
 */
import { isGtin, parseJson, truncateText } from "./format";

function returnPolicy(returns) {
  if (!returns) return null;
  return {
    "@type": "MerchantReturnPolicy",
    ...(returns.days && {
      merchantReturnDays: returns.days,
      returnMethod: returns.method,
      returnFees: returns.fees,
    }),
    applicableCountry: returns.countries,
    returnPolicyCategory: returns.category,
  };
}

function shippingDetails(shipping) {
  if (!shipping) return null;
  return {
    "@type": "OfferShippingDetails",
    shippingRate: {
      "@type": "MonetaryAmount",
      value: shipping.rate,
      currency: shipping.currency,
    },
    shippingDestination: shipping.countries.map((country) => ({
      "@type": "DefinedRegion",
      addressCountry: country,
    })),
    deliveryTime: {
      "@type": "ShippingDeliveryTime",
      handlingTime: {
        "@type": "QuantitativeValue",
        minValue: shipping.handling_min,
        maxValue: shipping.handling_max,
        unitCode: "DAY",
      },
      transitTime: {
        "@type": "QuantitativeValue",
        minValue: shipping.transit_min,
        maxValue: shipping.transit_max,
        unitCode: "DAY",
      },
    },
  };
}

const stripHtml = (html) =>
  String(html ?? "")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/**
 * @param {{ product: object, store: object, config: object }} input
 *   product: Admin API product with variants.nodes and rating metafields
 *   config: toEmbedConfig() output
 */
export function buildProductJsonLd({ product, store, config }) {
  const origin = store.url;
  const productUrl = `${origin}/products/${product.handle}`;
  const rating = parseJson(product.rating?.value, null);
  const ratingCount = Number.parseInt(product.ratingCount?.value, 10) || 0;
  const description = truncateText(stripHtml(product.description), 500);
  const image = product.featuredMedia?.preview?.image?.url;
  const shipping = shippingDetails(config.shipping);
  const returns = returnPolicy(config.returns);

  return {
    "@context": "https://schema.org",
    "@type": "Product",
    "@id": `${productUrl}#product`,
    ...(description && { description }),
    ...(image && { image }),
    ...(product.vendor && {
      brand: { "@type": "Brand", name: product.vendor },
    }),
    ...(rating &&
      ratingCount > 0 && {
        aggregateRating: {
          "@type": "AggregateRating",
          ratingValue: rating.value,
          bestRating: rating.scale_max,
          worstRating: rating.scale_min,
          ratingCount,
        },
      }),
    offers: (product.variants?.nodes ?? []).map((variant) => {
      const barcode = String(variant.barcode ?? "").trim();
      return {
        "@type": "Offer",
        url: `${productUrl}?variant=${String(variant.id).split("/").pop()}`,
        price: Number(variant.price),
        priceCurrency: store.currency,
        availability: `https://schema.org/${variant.availableForSale ? "InStock" : "OutOfStock"}`,
        itemCondition: "https://schema.org/NewCondition",
        ...(variant.sku && { sku: variant.sku }),
        ...(isGtin(barcode) && { gtin: barcode }),
        ...(shipping && { shippingDetails: shipping }),
        ...(returns && { hasMerchantReturnPolicy: returns }),
        seller: { "@type": "Organization", name: store.name },
      };
    }),
    name: product.title,
    url: productUrl,
  };
}

export function buildOrganizationJsonLd({ store, config }) {
  const returns = returnPolicy(config.returns);
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    "@id": `${store.url}/#organization`,
    ...(store.description && { description: stripHtml(store.description) }),
    ...(store.contactEmail && { email: store.contactEmail }),
    ...(returns && { hasMerchantReturnPolicy: returns }),
    name: store.name,
    url: store.url,
  };
}

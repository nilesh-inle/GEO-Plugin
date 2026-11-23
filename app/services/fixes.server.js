/**
 * Step 3 (Update): builds the proposed changes and applies the ones the
 * merchant approves.
 *
 *  robots.txt  -> templates/robots.txt.liquid (keeps Shopify's default rules)
 *  llms.txt    -> templates/llms.txt.liquid (regenerated when the catalog changes)
 *  schema      -> app-data metafield read by the geo-schema theme app embed
 */
import prisma from "../db.server";
import { ACTOR, recordChange, restoreChange } from "./changes.server";
import { assertNoUserErrors, gql } from "./admin.server";
import { buildStoreLlms, regenerateLlms } from "./llms.server";
import {
  getStore,
  patchStoreJson,
  toStoreView,
  updateFixState,
  updateStore,
} from "./store.server";
import { getAudit, getLatestAudit, startSync } from "./sync.server";
import { fetchStorefront } from "./storefront.server";
import {
  getAppEmbedStatus,
  getMainTheme,
  readThemeFiles,
  writeThemeFile,
} from "./theme.server";
import {
  FIX_STATUS,
  SCHEMA_METAFIELD,
  SYNC_MODE,
  THEME_FILES,
} from "../lib/constants";
import { parseJson, pluralize } from "../lib/format";
import { planRobotsFix } from "../lib/robots";
import { toLlmsTemplate } from "../lib/llms";
import { themeCodeEditorUrl } from "../lib/theme";
import {
  defaultSchemaSettings,
  normalizeSchemaSettings,
  normalizeSnippetRules,
  toEmbedConfig,
} from "../lib/schemaSettings";

const PUBLISHED = { status: "ACTIVE", url: { not: null } };
// ─── Schema settings ──────────────────────────────────────────────────────────

async function saveEmbedConfig(admin, store, settings, options) {
  let ownerId = store.appInstallationId;
  if (!ownerId) {
    const data = await gql(
      admin,
      `#graphql
      query GeoAppInstallation {
        currentAppInstallation {
          id
        }
      }`,
    );
    ownerId = data.currentAppInstallation.id;
  }

  const data = await gql(
    admin,
    `#graphql
    mutation GeoSchemaSettings($metafields: [MetafieldsSetInput!]!) {
      metafieldsSet(metafields: $metafields) {
        metafields {
          id
        }
        userErrors {
          field
          message
        }
      }
    }`,
    {
      metafields: [
        {
          ownerId,
          namespace: SCHEMA_METAFIELD.namespace,
          key: SCHEMA_METAFIELD.key,
          type: "json",
          value: JSON.stringify(toEmbedConfig(settings, store, options)),
        },
      ],
    },
  );
  assertNoUserErrors(data.metafieldsSet, "Saving schema settings");
}

// ─── Plan ─────────────────────────────────────────────────────────────────────

async function loadScan(runId) {
  if (!runId) return {};
  const run = await prisma.syncRun.findUnique({
    where: { id: runId },
    select: { scan: true },
  });
  return parseJson(run?.scan, {});
}

function planRobots({ audit, scan, template, store }) {
  const blocked = audit.robots.blocked ?? [];
  const agents = [
    ...new Set([...blocked, ...(store.fixState.robots?.agents ?? [])]),
  ];
  const block = store.fixState.robots?.blocked ?? [];
  const plan =
    (agents.length || block.length) && scan.robots?.text
      ? planRobotsFix({
          template,
          liveText: scan.robots.text,
          agents,
          block,
          paths: scan.robots.samplePaths ?? ["/"],
        })
      : null;

  return {
    status: audit.robots.status,
    blocked,
    agents,
    needed: Boolean(blocked.length && plan?.changed),
    removed: plan?.removed ?? [],
    added: plan?.added ?? [],
    content: plan?.changed ? plan.content : null,
    hasTemplate: template != null,
    original: template ?? null,
  };
}

async function planSchema({ shop, audit, store, embedEnabled }) {
  const fields = Object.fromEntries(
    (audit.schema.fields ?? []).map((item) => [item.key, item]),
  );
  const [total, withGtin, withReviews, missingGtin] = await Promise.all([
    prisma.product.count({ where: { shop, ...PUBLISHED } }),
    prisma.product.count({
      where: { shop, ...PUBLISHED, gtinCount: { gt: 0 } },
    }),
    prisma.product.count({
      where: { shop, ...PUBLISHED, ratingCount: { gt: 0 } },
    }),
    prisma.product.findMany({
      where: { shop, ...PUBLISHED, gtinCount: 0 },
      select: { id: true, title: true },
      orderBy: { title: "asc" },
      take: 5,
    }),
  ]);

  const items = [
    {
      key: "price",
      text:
        fields.price?.status === "issue"
          ? `Live prices on ${pluralize(total, "product")} (${fields.price.detail} today)`
          : `Live price and availability on ${pluralize(total, "product")}`,
    },
    {
      key: "shipping",
      text: `Add shipping and return policy to ${pluralize(total, "product")}`,
    },
    withReviews && {
      key: "rating",
      text: `Add reviews and rating from your reviews app to ${pluralize(withReviews, "product")}`,
    },
    withGtin && {
      key: "gtin",
      text: `Add GTIN from your barcodes to ${pluralize(withGtin, "product")}`,
    },
    { key: "organization", text: "Add Organization schema to the home page" },
  ].filter(Boolean);

  return {
    status: audit.schema.status,
    needed:
      audit.schema.status !== "ok" ||
      store.schemaStatus !== FIX_STATUS.APPLIED ||
      !embedEnabled,
    items,
    embedEnabled,
    gtinMissing: total - withGtin,
    gtinExamples: missingGtin,
    duplicatePages: audit.schema.duplicatePages ?? 0,
    settings: store.schemaSettings ?? defaultSchemaSettings(store),
  };
}

/** Everything the Update screen shows. Reads the theme once; no writes. */
export async function getFixPlan(admin, shop) {
  const [storeRow, audit] = await Promise.all([
    getStore(shop),
    getLatestAudit(shop),
  ]);
  const store = toStoreView(storeRow);
  if (!store || !audit) return null;

  const theme = await getMainTheme(admin);
  const [files, embedEnabled, llms, scan] = await Promise.all([
    readThemeFiles(admin, theme.id, [THEME_FILES.robots]),
    getAppEmbedStatus(admin, theme.id),
    buildStoreLlms(shop),
    loadScan(audit.runId),
  ]);

  return {
    theme,
    store: { name: store.name, url: store.url, currency: store.currency },
    robots: planRobots({
      audit,
      scan,
      template: files[THEME_FILES.robots],
      store,
    }),
    llms: {
      status: audit.llms.status,
      // Shopify's default llms.txt is a working setup; replacing it is optional.
      needed: audit.llms.status !== "ok",
      managed: Boolean(audit.llms.managed),
      shopifyDefault: Boolean(audit.llms.shopifyDefault),
      findings: audit.llms.findings ?? [],
      markdown: llms.markdown,
      stats: llms.stats,
    },
    schema: await planSchema({ shop, audit, store, embedEnabled }),
  };
}

// ─── Apply ────────────────────────────────────────────────────────────────────

/** Writes a theme file. Falls back to a manual step when Shopify denies theme writes. */
async function writeOrFallback(admin, themeId, filename, content) {
  try {
    await writeThemeFile(admin, themeId, filename, content);
    return { status: FIX_STATUS.APPLIED, manual: null, message: null };
  } catch (error) {
    if (error.isAccessDenied) {
      return {
        status: FIX_STATUS.MANUAL,
        manual: { filename, content },
        message:
          "Shopify didn't allow the app to edit theme files. Add the template once by hand.",
      };
    }
    return { status: FIX_STATUS.FAILED, manual: null, message: error.message };
  }
}

async function applyRobots(admin, shop, theme, robotsPlan, actor) {
  const result = robotsPlan.content
    ? await writeOrFallback(
        admin,
        theme.id,
        THEME_FILES.robots,
        robotsPlan.content,
      )
    : { status: FIX_STATUS.APPLIED, manual: null, message: null };

  if (robotsPlan.content && result.status === FIX_STATUS.APPLIED) {
    await recordChange(shop, {
      area: "robots",
      title: `Allowed ${robotsPlan.agents.join(", ")} in robots.txt`,
      detail: `${THEME_FILES.robots} · theme ${theme.name}`,
      items: robotsPlan.agents.length,
      actor,
      before: {
        kind: "themeFile",
        themeId: theme.id,
        filename: THEME_FILES.robots,
        content: robotsPlan.original,
      },
    });
  }

  await updateStore(shop, { robotsStatus: result.status });
  await updateFixState(shop, "robots", {
    agents: robotsPlan.agents,
    manual: result.manual,
    message: result.message,
    themeId: theme.id,
  });
  return result;
}

async function applyLlms(admin, shop, theme, actor = ACTOR.MERCHANT) {
  let result;
  try {
    const files = await readThemeFiles(admin, theme.id, [THEME_FILES.llms]);
    await regenerateLlms(admin, shop, { themeId: theme.id });
    result = { status: FIX_STATUS.APPLIED, manual: null, message: null };
    await recordChange(shop, {
      area: "llms",
      title: files[THEME_FILES.llms] == null
        ? "Published llms.txt"
        : "Updated llms.txt",
      detail: `${THEME_FILES.llms} · theme ${theme.name}`,
      actor,
      before: {
        kind: "themeFile",
        themeId: theme.id,
        filename: THEME_FILES.llms,
        content: files[THEME_FILES.llms],
      },
    });
  } catch (error) {
    if (error.isAccessDenied) {
      const { markdown } = await buildStoreLlms(shop);
      result = {
        status: FIX_STATUS.MANUAL,
        manual: {
          filename: THEME_FILES.llms,
          content: toLlmsTemplate(markdown),
        },
        message:
          "Shopify didn't allow the app to edit theme files. Add the template once by hand.",
      };
    } else {
      result = {
        status: FIX_STATUS.FAILED,
        manual: null,
        message: error.message,
      };
    }
  }

  await updateStore(shop, { llmsStatus: result.status });
  await updateFixState(shop, "llms", {
    manual: result.manual,
    message: result.message,
    themeId: theme.id,
  });
  return result;
}

async function applySchema(admin, shop, store, settingsInput, actor = ACTOR.MERCHANT) {
  const settings = normalizeSchemaSettings(settingsInput, store);
  let result;
  try {
    await saveEmbedConfig(admin, store, settings);
    result = { status: FIX_STATUS.APPLIED, message: null };
    await recordChange(shop, {
      area: "schema",
      title:
        store.schemaStatus === FIX_STATUS.APPLIED
          ? "Updated product schema settings"
          : "Turned on product schema",
      detail: "GEO app embed · shipping and returns",
      actor,
      before: {
        kind: "schema",
        status: store.schemaStatus,
        settings: store.schemaSettings,
      },
    });
  } catch (error) {
    result = { status: FIX_STATUS.FAILED, message: error.message };
  }

  await updateStore(shop, {
    schemaStatus: result.status,
    schemaSettings: JSON.stringify(settings),
  });
  await updateFixState(shop, "schema", { message: result.message });
  return result;
}

/** Publishes (or refreshes) llms.txt on the live theme from the llms.txt page. */
export async function publishLlms(admin, shop) {
  return applyLlms(admin, shop, await getMainTheme(admin));
}

/** Saves shipping and returns details for the schema app embed. */
export async function saveSchemaSettings(admin, shop, settingsInput) {
  const store = toStoreView(await getStore(shop));
  if (!store) throw new Error("Run a sync first.");
  return applySchema(admin, shop, store, settingsInput);
}

/** Templates the merchant still has to add by hand (status "manual"). */
export function getManualTemplates(store, shop) {
  return ["robots", "llms"]
    .filter(
      (area) =>
        store[`${area}Status`] === FIX_STATUS.MANUAL &&
        store.fixState[area]?.manual,
    )
    .map((area) => {
      const { filename, content } = store.fixState[area].manual;
      return {
        area,
        filename,
        content,
        editorUrl: themeCodeEditorUrl(
          shop,
          store.fixState[area].themeId,
          filename,
        ),
      };
    });
}

/**
 * Re-applies managed templates to a newly published theme (themes/publish).
 * robots.txt is re-planned against the new theme's own template.
 */
export async function reapplyManagedTemplates(admin, shop, themeId) {
  const store = toStoreView(await getStore(shop));
  if (!store) return;

  const agents = store.fixState.robots?.agents ?? [];
  const block = store.fixState.robots?.blocked ?? [];
  if (
    store.robotsStatus === FIX_STATUS.APPLIED &&
    (agents.length || block.length) &&
    store.url
  ) {
    const [files, live] = await Promise.all([
      readThemeFiles(admin, themeId, [THEME_FILES.robots]),
      fetchStorefront(`${store.url}/robots.txt`),
    ]);
    const plan = planRobotsFix({
      template: files[THEME_FILES.robots],
      liveText: live.ok ? live.text : "",
      agents,
      block,
      paths: ["/"],
    });
    if (plan.changed)
      await writeThemeFile(admin, themeId, THEME_FILES.robots, plan.content);
    await updateFixState(shop, "robots", { themeId });
  }

  if (store.llmsStatus === FIX_STATUS.APPLIED) {
    await regenerateLlms(admin, shop, { themeId });
    await updateFixState(shop, "llms", { themeId });
  }
}

/**
 * Applies the selected areas, records the baseline audit for the before/after
 * summary, and starts a verification scan.
 * @param {{ robots: boolean, llms: boolean, schema: boolean }} areas
 */
export async function applyFixes(admin, shop, { areas, schemaSettings }) {
  const store = toStoreView(await getStore(shop));
  const plan = await getFixPlan(admin, shop);
  if (!store || !plan) throw new Error("Run a sync before applying fixes.");

  const results = {};
  if (areas.robots && plan.robots.needed)
    results.robots = await applyRobots(
      admin,
      shop,
      plan.theme,
      plan.robots,
      ACTOR.MERCHANT,
    );
  if (areas.llms) results.llms = await applyLlms(admin, shop, plan.theme);
  if (areas.schema)
    results.schema = await applySchema(admin, shop, store, schemaSettings);

  // The audit the merchant reviewed (latest full scan) is the "before" column.
  const baselineRun = await prisma.syncRun.findFirst({
    where: { shop, mode: SYNC_MODE.FULL, auditId: { not: null } },
    orderBy: { startedAt: "desc" },
    select: { auditId: true },
  });
  const baseline = await getAudit(baselineRun?.auditId);
  await updateStore(shop, {
    optimizedAt: new Date(),
    baselineAuditId: baseline?.id ?? store.baselineAuditId,
  });

  await startSync(shop, { mode: SYNC_MODE.VERIFY });
  return results;
}

// ─── Restore ──────────────────────────────────────────────────────────────────

async function deleteEmbedConfig(admin, store) {
  const data = await gql(
    admin,
    `#graphql
    mutation GeoSchemaSettingsDelete($metafields: [MetafieldIdentifierInput!]!) {
      metafieldsDelete(metafields: $metafields) {
        deletedMetafields {
          key
        }
        userErrors {
          field
          message
        }
      }
    }`,
    {
      metafields: [
        {
          ownerId: store.appInstallationId,
          namespace: SCHEMA_METAFIELD.namespace,
          key: SCHEMA_METAFIELD.key,
        },
      ],
    },
  );
  assertNoUserErrors(data.metafieldsDelete, "Removing schema settings");
}

async function restoreSchema(admin, shop, before) {
  const store = toStoreView(await getStore(shop));
  if (before.status === FIX_STATUS.APPLIED && before.settings) {
    await saveEmbedConfig(admin, store, before.settings);
    await updateStore(shop, {
      schemaStatus: FIX_STATUS.APPLIED,
      schemaSettings: JSON.stringify(before.settings),
    });
  } else {
    const hasSnippets =
      Object.keys(normalizeSnippetRules(store.settings?.snippets)).length > 0;
    if (hasSnippets)
      await saveEmbedConfig(
        admin,
        store,
        store.schemaSettings ?? defaultSchemaSettings(store),
        { schema: false },
      );
    else if (store.appInstallationId) await deleteEmbedConfig(admin, store);
    await updateStore(shop, { schemaStatus: FIX_STATUS.NONE });
  }
}

/** Saves snippet rules (how much AI answers may quote) into the app embed config. */
export async function saveSnippetRules(admin, shop, input) {
  const rules = normalizeSnippetRules(input);
  await patchStoreJson(shop, "settings", { snippets: rules });
  const store = toStoreView(await getStore(shop));
  await saveEmbedConfig(
    admin,
    store,
    store.schemaSettings ?? defaultSchemaSettings(store),
    { schema: store.schemaStatus === FIX_STATUS.APPLIED },
  );
  const count = Object.keys(rules).length;
  await recordChange(shop, {
    area: "schema",
    title: count
      ? `Set AI snippet rules for ${count} page ${count === 1 ? "type" : "types"}`
      : "Removed AI snippet rules",
    detail: "GEO app embed · robots meta tag",
    items: Math.max(1, count),
  });
  return rules;
}

/**
 * Restores a published change from history, resets the area's status when a
 * GEO-managed file is removed, and re-checks the store.
 */
export async function restoreFix(admin, shop, id) {
  const change = await restoreChange(admin, shop, id, { restoreSchema });
  if (change.area === "robots") {
    await updateStore(shop, { robotsStatus: FIX_STATUS.NONE });
    await updateFixState(shop, "robots", { agents: [] });
  }
  if (change.area === "llms")
    await updateStore(shop, { llmsStatus: FIX_STATUS.NONE });
  if (["robots", "llms", "schema"].includes(change.area))
    await startSync(shop, { mode: SYNC_MODE.VERIFY });
  return change;
}

/**
 * Puts robots.txt, llms.txt and the schema settings back to how they were
 * before GEO changed them. Shopify revokes the app's access when it is
 * uninstalled, so this has to run beforehand.
 * Returns { removed: string[], failed: { area, message }[] }.
 */
export async function removeGeoFiles(admin, shop) {
  const rows = await prisma.changeLog.findMany({
    where: {
      shop,
      area: { in: ["robots", "llms", "schema"] },
      status: "published",
    },
    orderBy: { createdAt: "asc" },
  });

  const removed = [];
  const failed = [];
  for (const area of ["robots", "llms", "schema"]) {
    // The oldest published change holds the state from before GEO touched it.
    const first = rows.find((row) => row.area === area);
    if (!first) continue;
    try {
      await restoreFix(admin, shop, first.id);
      removed.push(area);
    } catch (error) {
      failed.push({ area, message: error.message });
    }
  }
  return { removed, failed };
}

/** Applies one area from the Fix list or an AI access tab. */
export async function applyArea(admin, shop, area) {
  const store = toStoreView(await getStore(shop));
  return applyFixes(admin, shop, {
    areas: { [area]: true },
    schemaSettings: store?.schemaSettings ?? defaultSchemaSettings(store),
  });
}

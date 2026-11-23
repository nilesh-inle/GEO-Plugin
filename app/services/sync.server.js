/**
 * Sync-and-scan job runner.
 *
 * Jobs run in the background of this Node process and record progress in
 * SyncRun, which the UI polls. A job interrupted by a restart is marked
 * failed after STALE_MS and can be started again. For multi-instance
 * deployments, move `execute` onto a queue worker; the SyncRun contract stays the same.
 */
import prisma from "../db.server";
import { unauthenticated } from "../shopify.server";
import { buildAudit } from "../lib/audit";
import {
  FIX_STATUS,
  RUN_STATUS,
  STEP_STATUS,
  SYNC_MODE,
  SYNC_STEPS,
  VERIFY_STEPS,
} from "../lib/constants";
import { parseJson, pluralize } from "../lib/format";
import {
  countCatalog,
  syncCollections,
  syncProducts,
  syncShopInfo,
} from "./catalog.server";
import { regenerateLlms } from "./llms.server";
import {
  scanLlms,
  scanRobots,
  scanSchema,
  scanStorefront,
} from "./scan.server";
import { readinessFor } from "./issues.server";
import { getStore, updateStore } from "./store.server";
import { getMainTheme } from "./theme.server";

const STALE_MS = 3 * 60_000;
const PROGRESS_WRITE_MS = 1000;
const KEEP_RUNS = 5;
const KEEP_AUDITS = 12;

// Survives dev-server hot reloads.
const jobs = global.__geoSyncJobs ?? (global.__geoSyncJobs = new Map());

const STEP_ORDER = SYNC_STEPS.map((step) => step.key);
const SCAN_STEPS = ["robots", "llms", "schema"];

export function parseRun(run) {
  if (!run) return null;
  return {
    id: run.id,
    mode: run.mode,
    status: run.status,
    error: run.error,
    auditId: run.auditId,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    steps: parseJson(run.steps, {}),
    progress: parseJson(run.progress, {}),
  };
}

async function failIfStale(run) {
  const stale =
    run?.status === RUN_STATUS.RUNNING &&
    !jobs.has(run.shop) &&
    Date.now() - run.updatedAt.getTime() > STALE_MS;
  if (!stale) return run;
  return prisma.syncRun.update({
    where: { id: run.id },
    data: {
      status: RUN_STATUS.FAILED,
      error: "The scan was interrupted. Start it again.",
      finishedAt: new Date(),
    },
  });
}

export async function getLatestRun(shop, where = {}) {
  const run = await prisma.syncRun.findFirst({
    where: { shop, ...where },
    orderBy: { startedAt: "desc" },
  });
  return failIfStale(run);
}

export async function getAudit(id) {
  if (!id) return null;
  const row = await prisma.audit.findUnique({ where: { id } });
  return row
    ? {
        ...parseJson(row.data, {}),
        id: row.id,
        runId: row.runId,
        createdAt: row.createdAt,
      }
    : null;
}

export async function getLatestAudit(shop) {
  const row = await prisma.audit.findFirst({
    where: { shop },
    orderBy: { createdAt: "desc" },
  });
  return row ? getAudit(row.id) : null;
}

/** Steps a new run executes, the steps it displays, and the scan data it starts from. */
async function planRun(shop, mode) {
  if (mode === SYNC_MODE.FULL) {
    return {
      execute: STEP_ORDER,
      display: STEP_ORDER.map((key) => [key, { status: STEP_STATUS.PENDING }]),
      scan: {},
    };
  }

  const previous = await prisma.syncRun.findFirst({
    where: { shop, status: { not: RUN_STATUS.RUNNING } },
    orderBy: { startedAt: "desc" },
  });
  const scan = parseJson(previous?.scan, {});

  if (mode === SYNC_MODE.VERIFY) {
    return {
      execute: VERIFY_STEPS,
      display: VERIFY_STEPS.map((key) => [
        key,
        { status: STEP_STATUS.PENDING },
      ]),
      scan,
    };
  }

  // RETRY: re-run only the steps that failed last time.
  const steps = parseJson(previous?.steps, {});
  const failed = Object.keys(steps).filter(
    (key) => steps[key].status === STEP_STATUS.FAILED,
  );
  const execute = failed.length ? failed : Object.keys(steps);
  return {
    execute,
    display: Object.entries(steps).map(([key, step]) => [
      key,
      execute.includes(key) ? { status: STEP_STATUS.PENDING } : step,
    ]),
    scan,
  };
}

/**
 * Starts a job unless one is already running for the shop.
 * @param {string} shop
 * @param {{ mode?: "full"|"verify"|"retry" }} [options]
 */
export async function startSync(shop, { mode = SYNC_MODE.FULL } = {}) {
  const latest = await getLatestRun(shop);
  if (latest?.status === RUN_STATUS.RUNNING || jobs.has(shop)) return latest;

  // Reserve synchronously so a double submit can't start two jobs.
  jobs.set(shop, null);
  let run;
  let plan;
  try {
    plan = await planRun(shop, mode);
    run = await prisma.syncRun.create({
      data: {
        shop,
        mode,
        steps: JSON.stringify(Object.fromEntries(plan.display)),
        scan: JSON.stringify(plan.scan),
      },
    });
  } catch (error) {
    jobs.delete(shop);
    throw error;
  }

  const job = execute(run, plan)
    .catch(async (error) => {
      console.error(`[geo] sync ${run.id} for ${shop} failed`, error);
      await prisma.syncRun
        .update({
          where: { id: run.id },
          data: {
            status: RUN_STATUS.FAILED,
            error: error.message,
            finishedAt: new Date(),
          },
        })
        .catch(() => {});
    })
    .finally(() => jobs.delete(shop));
  jobs.set(shop, job);

  return run;
}

async function execute(run, plan) {
  const { shop } = run;
  const { admin } = await unauthenticated.admin(shop);
  const steps = Object.fromEntries(plan.display);
  const scan = plan.scan;
  let progressWrittenAt = 0;
  let themeId = null;
  let store = await getStore(shop);

  const save = (data) => prisma.syncRun.update({ where: { id: run.id }, data });
  const setStep = (key, status, detail) => {
    steps[key] = { status, detail };
    return save({ steps: JSON.stringify(steps), scan: JSON.stringify(scan) });
  };
  const mainThemeId = async () => (themeId ??= (await getMainTheme(admin)).id);
  const storeUrl = () => {
    if (!store?.url)
      throw new Error("Store details are missing. Run a full sync.");
    return store.url;
  };

  const handlers = {
    catalog: async () => {
      const products = await syncProducts(admin, shop);
      const collections = await syncCollections(admin, shop);
      return `${pluralize(products, "product")} and ${pluralize(collections, "collection")} synced`;
    },
    policies: async () => {
      store = await syncShopInfo(admin, shop);
      const count = parseJson(store.policies, []).length;
      return count
        ? `${pluralize(count, "policy", "policies")} found`
        : "No policies published";
    },
    robots: async () => {
      scan.robots = await scanRobots({
        admin,
        themeId: await mainThemeId(),
        storeUrl: storeUrl(),
        shop,
      });
      return "Read";
    },
    llms: async () => {
      scan.llms = await scanLlms({
        admin,
        themeId: await mainThemeId(),
        storeUrl: storeUrl(),
      });
      return "Read";
    },
    schema: async () => {
      if (scan.storefront?.passwordProtected)
        return "Skipped: store is password protected";
      scan.schema = await scanSchema({
        admin,
        themeId: await mainThemeId(),
        shop,
        onProgress: (done, total) => {
          if (
            Date.now() - progressWrittenAt < PROGRESS_WRITE_MS &&
            done !== total
          )
            return;
          progressWrittenAt = Date.now();
          save({ progress: JSON.stringify({ done, total }) }).catch(() => {});
        },
      });
      return `${pluralize(scan.schema.scanned, "page")} checked`;
    },
  };

  let storefrontChecked = false;
  for (const key of STEP_ORDER.filter((step) => plan.execute.includes(step))) {
    // The storefront check feeds robots, llms and schema; run it once before the first of them.
    if (SCAN_STEPS.includes(key) && !storefrontChecked && store?.url) {
      scan.storefront = await scanStorefront(store.url);
      storefrontChecked = true;
    }

    await setStep(key, STEP_STATUS.RUNNING);
    try {
      await setStep(key, STEP_STATUS.DONE, await handlers[key]());
    } catch (error) {
      console.error(`[geo] step ${key} failed for ${shop}`, error);
      await setStep(key, STEP_STATUS.FAILED, error.message);
    }
  }

  const audit = buildAudit(scan);
  const readiness = await readinessFor(shop, audit).catch((error) => {
    console.error(`[geo] readiness for ${shop} failed`, error);
    return null;
  });
  const auditRow = await prisma.audit.create({
    data: {
      shop,
      runId: run.id,
      data: JSON.stringify(audit),
      issues: audit.totals.issues,
      warnings: audit.totals.warnings,
      readiness,
    },
  });

  await save({
    status: RUN_STATUS.COMPLETED,
    auditId: auditRow.id,
    finishedAt: new Date(),
    steps: JSON.stringify(steps),
    scan: JSON.stringify(scan),
  });

  if (run.mode === SYNC_MODE.FULL && store) {
    store = await updateStore(shop, {
      syncedAt: new Date(),
      ...(await countCatalog(shop)),
    });
    if (store.llmsStatus === FIX_STATUS.APPLIED && store.llmsAutoUpdate) {
      await regenerateLlms(admin, shop).catch((error) =>
        console.error("[geo] llms refresh failed", error),
      );
    }
  }

  await pruneHistory(shop);
}

const AUDIT_INTERVAL_MS = 7 * 24 * 60 * 60_000;

/**
 * Starts a full sync for stores that turned on the weekly audit
 * (Settings › Automations) and haven't been scanned for a week.
 */
export async function runDueAudits() {
  const stores = await prisma.store.findMany({
    where: {
      syncedAt: { lte: new Date(Date.now() - AUDIT_INTERVAL_MS) },
      settings: { contains: '"weeklyAudit":true' },
    },
    select: { shop: true },
    take: 10,
  });
  for (const { shop } of stores) {
    if (jobs.has(shop)) continue;
    const recent = await prisma.syncRun.findFirst({
      where: { shop, startedAt: { gte: new Date(Date.now() - 6 * 60 * 60_000) } },
      select: { id: true },
    });
    if (recent) continue;
    await startSync(shop).catch((error) =>
      console.error(`[geo] weekly audit failed for ${shop}`, error),
    );
  }
}

/** Keeps the last few runs and audits, plus the baseline audit. */
async function pruneHistory(shop) {
  const store = await getStore(shop);
  const keepRuns = await prisma.syncRun.findMany({
    where: { shop },
    orderBy: { startedAt: "desc" },
    take: KEEP_RUNS,
    select: { id: true, auditId: true },
  });
  // Audits are small; keep more of them for the readiness trend.
  const recentAudits = await prisma.audit.findMany({
    where: { shop },
    orderBy: { createdAt: "desc" },
    take: KEEP_AUDITS,
    select: { id: true },
  });
  const keepAudits = [
    store?.baselineAuditId,
    ...keepRuns.map((run) => run.auditId),
    ...recentAudits.map((audit) => audit.id),
  ].filter(Boolean);

  await prisma.$transaction([
    prisma.syncRun.deleteMany({
      where: { shop, id: { notIn: keepRuns.map((run) => run.id) } },
    }),
    prisma.audit.deleteMany({ where: { shop, id: { notIn: keepAudits } } }),
  ]);
}

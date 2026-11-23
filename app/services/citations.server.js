/**
 * AI citation tracking: loads saved answers and catalog data for the report
 * in app/lib/citationReport.js, and keeps weekly CitationWeek snapshots so
 * trends outlast the answers (deleted after TRACK.keepWeeks).
 */
import prisma from "../db.server";
import {
  buildPromptDetail,
  buildPromptRows,
  buildVisibilityBreakdown,
  buildVisibilitySummary,
  summarizeWeeks,
} from "../lib/citationReport";
import { AI_TOOLS } from "../lib/aiTools";
import { brandName, trackedDomains } from "../lib/citations";
import { previousRange } from "../lib/citationView";
import { TOOL_STATUS, TRACK } from "../lib/constants";
import { parseJson } from "../lib/format";
import { MAX_COMPETITORS, parseCompetitor } from "../lib/settings";
import { getStore, toStoreView, updateStore } from "./store.server";

const DAY_MS = 86_400_000;
/** Weekly snapshots older than this are deleted. */
const KEEP_SNAPSHOT_WEEKS = 52;

const withSources = (answer) => ({ ...answer, sources: parseJson(answer.sources, []) });

/**
 * Rebuilds the weekly snapshots from saved answers. Weeks whose answers are
 * all still saved are rewritten; older weeks may be missing answers, so an
 * existing snapshot for them is kept and only a missing one is added.
 */
export async function refreshCitationWeeks(shop) {
  const storeRow = await getStore(shop);
  if (!storeRow) return 0;
  const store = toStoreView(storeRow);
  const answers = await prisma.trackAnswer.findMany({
    where: { shop, error: null },
    select: {
      provider: true,
      cited: true,
      mentioned: true,
      text: true,
      sources: true,
      createdAt: true,
    },
  });
  const summaries = summarizeWeeks(answers.map(withSources), {
    domains: trackedDomains(storeRow, shop),
    competitors: store.competitors,
  });

  // The first week whose answers can't have been deleted yet.
  const retainedFrom = new Date(Date.now() - 7 * TRACK.keepWeeks * DAY_MS);
  const complete = summaries.filter((row) => row.weekStart >= retainedFrom);
  const partial = summaries.filter((row) => row.weekStart < retainedFrom);
  const data = (row) => ({
    shop,
    weekStart: row.weekStart,
    provider: row.provider,
    answers: row.answers,
    cited: row.cited,
    mentioned: row.mentioned,
    links: row.links,
    competitors: JSON.stringify(row.competitors),
  });

  await prisma.$transaction([
    prisma.citationWeek.deleteMany({
      where: {
        shop,
        OR: [
          { weekStart: { gte: retainedFrom } },
          { weekStart: { lt: new Date(Date.now() - 7 * KEEP_SNAPSHOT_WEEKS * DAY_MS) } },
        ],
      },
    }),
    ...complete.map((row) => prisma.citationWeek.create({ data: data(row) })),
    ...partial.map((row) =>
      prisma.citationWeek.upsert({
        where: {
          shop_weekStart_provider: {
            shop,
            weekStart: row.weekStart,
            provider: row.provider,
          },
        },
        create: data(row),
        update: {},
      }),
    ),
  ]);
  return summaries.length;
}

/** Rebuilds snapshots without failing the caller; logged when it fails. */
export async function refreshCitationWeeksSafely(shop) {
  try {
    await refreshCitationWeeks(shop);
  } catch (error) {
    console.warn(`[geo] Citation snapshots for ${shop} not updated: ${error.message}`);
  }
}

// ─── Watched competitors ──────────────────────────────────────────────────────

async function saveCompetitors(shop, competitors) {
  await updateStore(shop, { competitors: JSON.stringify(competitors) });
  // Weekly snapshots count each competitor's citations.
  await refreshCitationWeeksSafely(shop);
}

/** Adds a competitor typed by the merchant (see parseCompetitor). */
export async function addCompetitor(shop, input) {
  const competitor = parseCompetitor(input);
  const competitors = toStoreView(await getStore(shop))?.competitors ?? [];
  if (competitors.length >= MAX_COMPETITORS)
    throw new Error(`Add up to ${MAX_COMPETITORS} competitors.`);
  const name = competitor.name.toLowerCase();
  const taken = competitors.find(
    (entry) =>
      String(entry.name ?? "").toLowerCase() === name ||
      (competitor.domain && entry.domain === competitor.domain),
  );
  if (taken) throw new Error(`${taken.name} is already a competitor.`);
  await saveCompetitors(shop, [...competitors, competitor]);
}

export async function removeCompetitor(shop, name) {
  const competitors = toStoreView(await getStore(shop))?.competitors ?? [];
  await saveCompetitors(
    shop,
    competitors.filter((entry) => entry.name !== name),
  );
}

/** Limits a query to some AI tools. Empty means all. */
function onlyTools({ engines = [] }) {
  return engines.length ? { provider: { in: engines } } : {};
}

/** Prisma filter for answers created in `range` (see parseRange). */
const inRange = ({ from, to }) => ({ gte: from, lt: to });

/** Comparing with the period before needs answers that old. */
function previousIsKept(previous) {
  return previous.from.getTime() >= Date.now() - 7 * TRACK.keepWeeks * DAY_MS;
}

// ─── Prompts: the table and one prompt's details ──────────────────────────────

const ANSWER_FIELDS = {
  id: true,
  promptId: true,
  provider: true,
  model: true,
  cited: true,
  mentioned: true,
  text: true,
  sources: true,
  createdAt: true,
};

/**
 * AI engines for the filter: tracked ones (connected, or with saved answers)
 * and the rest, which can be connected in settings.
 */
export async function getEngineOptions(shop) {
  const [connections, used] = await Promise.all([
    prisma.aiTool.findMany({ where: { shop }, select: { provider: true, status: true } }),
    prisma.trackAnswer.findMany({
      where: { shop, error: null },
      distinct: ["provider"],
      select: { provider: true },
    }),
  ]);
  const usedIds = new Set(used.map((row) => row.provider));
  return AI_TOOLS.map((tool) => {
    const connection = connections.find((row) => row.provider === tool.id);
    return {
      id: tool.id,
      name: tool.name,
      company: tool.company,
      connected: connection?.status === TOOL_STATUS.CONNECTED,
      tracked: Boolean(connection) || usedIds.has(tool.id),
    };
  });
}

/**
 * What the AI visibility page shows for `range`: one row per prompt (the
 * selected ones, and the archived ones, which are not selected), and the
 * summary cards for the selected prompts' answers compared with the period
 * before. `engines` limits both to some AI tools.
 */
export async function getPromptCitations(shop, { range, engines = [] } = {}) {
  const previousPeriod = previousRange(range);
  const byTool = onlyTools({ engines });
  const [storeRow, answers, previous, prompts] = await Promise.all([
    getStore(shop),
    prisma.trackAnswer.findMany({
      where: { shop, error: null, createdAt: inRange(range), ...byTool },
      select: ANSWER_FIELDS,
    }),
    prisma.trackAnswer.findMany({
      where: { shop, error: null, createdAt: inRange(previousPeriod), ...byTool },
      select: ANSWER_FIELDS,
    }),
    prisma.trackPrompt.findMany({
      where: { shop },
      orderBy: [{ selected: "desc" }, { createdAt: "asc" }],
    }),
  ]);
  const competitors = toStoreView(storeRow)?.competitors ?? [];
  const domains = trackedDomains(storeRow, shop);
  const active = new Set(prompts.filter((prompt) => prompt.selected).map((prompt) => prompt.id));
  const ofActive = (list) => list.filter((answer) => active.has(answer.promptId)).map(withSources);

  return {
    rows: buildPromptRows({ answers: answers.map(withSources), prompts, domains, competitors }),
    summary: buildVisibilitySummary({
      answers: ofActive(answers),
      previous: ofActive(previous),
      domains,
      competitors,
    }),
    breakdown: buildVisibilityBreakdown({
      answers: ofActive(answers),
      domains,
      competitors,
      storeName: brandName(storeRow),
    }),
    previousAvailable: previousIsKept(previousPeriod),
    selectedPrompts: active.size,
    watchedCompetitors: competitors.filter((competitor) => competitor.domain).length,
  };
}

/**
 * One prompt's details for `range`, or null when it doesn't exist.
 * `engines` limits it to some AI tools.
 */
export async function getPromptDetail(shop, promptId, { range, engines = [] } = {}) {
  const prompt = await prisma.trackPrompt.findFirst({ where: { shop, id: promptId } });
  if (!prompt) return null;
  const [storeRow, answers] = await Promise.all([
    getStore(shop),
    prisma.trackAnswer.findMany({
      where: {
        shop,
        promptId,
        error: null,
        createdAt: inRange(range),
        ...onlyTools({ engines }),
      },
      orderBy: { createdAt: "desc" },
      select: ANSWER_FIELDS,
    }),
  ]);
  return buildPromptDetail({
    prompt,
    answers: answers.map(withSources),
    domains: trackedDomains(storeRow, shop),
    competitors: toStoreView(storeRow)?.competitors ?? [],
    storeName: brandName(storeRow),
    days: range.days,
    now: range.to,
  });
}

/**
 * Track phase: AI tools connected with the merchant's own API keys, the
 * prompts they track, and the runs that ask each tool and record whether the
 * answer cites the store.
 *
 * Runs execute in the background of this Node process (like sync.server.js)
 * and record progress in TrackRun, which the UI polls. A scheduler starts the
 * weekly run for each store. For multi-instance deployments, move
 * `executeRun` and `runDueTracking` onto a queue worker.
 */
import prisma from "../db.server";
import { AI_TOOLS, getAiTool } from "../lib/aiTools";
import {
  MAX_TRACK_DOMAINS,
  analyzeAnswer,
  brandName,
  brandTerms,
  isGoogleRedirect,
  matchesDomain,
  normalizeHost,
  parseDomainList,
  storeDomains,
  trackedDomains,
  tracksOtherSite,
} from "../lib/citations";
import {
  PROMPT_KINDS,
  RUN_STATUS,
  TOOL_STATUS,
  TRACK,
  TRACK_TRIGGER,
} from "../lib/constants";
import { parseJson } from "../lib/format";
import { selectCollections, selectTopProducts } from "../lib/llms";
import {
  buildSiteSuggestionRequest,
  buildSuggestionRequest,
  catalogSuggestions,
  cleanPromptText,
  normalizeSuggestions,
  siteSuggestions,
  summarizeSite,
  unreadSite,
} from "../lib/prompts";
import { AiToolError, getAdapter } from "./ai/index.server";
import { refreshCitationWeeksSafely } from "./citations.server";
import { decryptSecret, encryptSecret, keyHint } from "./secrets.server";
import { getStore, toStoreView, updateStore } from "./store.server";
import { fetchStorefront, mapLimit } from "./storefront.server";
import { runDueAudits } from "./sync.server";

const DAY_MS = 24 * 60 * 60_000;
const STALE_MS = 10 * 60_000;
const PROGRESS_WRITE_MS = 1000;
const MAX_ANSWER_CHARS = 4000;
const MAX_SOURCES = 12;
const REDIRECT_TIMEOUT_MS = 5000;
const KEEP_RUNS = 10;
const SCHEDULER_MS = 15 * 60_000;
const MAX_PARALLEL_RUNS = 3;

// Survive dev-server hot reloads.
const jobs = global.__geoTrackJobs ?? (global.__geoTrackJobs = new Map());

const addDays = (date, days) => new Date(date.getTime() + days * DAY_MS);
const clampAnswers = (value) =>
  Math.min(TRACK.maxAnswers, Math.max(1, Number.parseInt(value, 10) || 1));

// ─── AI tools ─────────────────────────────────────────────────────────────────

function cleanKey(value) {
  const key = String(value ?? "").trim();
  if (!key) return "";
  if (/\s/.test(key) || key.length < 8 || key.length > 400)
    throw new AiToolError("That doesn't look like an API key.", {
      kind: "auth",
    });
  return key;
}

function connectionView(row) {
  return {
    model: row.model,
    keyHint: row.keyHint,
    status: row.status,
    lastError: row.lastError,
    connectedAt: row.connectedAt,
  };
}

/** Every AI tool with its connection, if any. Never includes the key. */
export async function getTools(shop) {
  const rows = await prisma.aiTool.findMany({ where: { shop } });
  const byProvider = new Map(rows.map((row) => [row.provider, row]));
  return AI_TOOLS.map((tool) => {
    const row = byProvider.get(tool.id);
    return { ...tool, connection: row ? connectionView(row) : null };
  });
}

async function savedKey(shop, provider) {
  const row = await prisma.aiTool.findUnique({
    where: { shop_provider: { shop, provider } },
  });
  if (!row) return { row: null, apiKey: null };
  const apiKey = decryptSecret(row.apiKey);
  if (!apiKey)
    throw new AiToolError("The saved key can't be read. Enter it again.", {
      kind: "auth",
    });
  return { row, apiKey };
}

/** Models for the connect modal, from the typed key or the saved one. */
export async function loadModels(shop, provider, apiKeyInput) {
  if (!getAiTool(provider)) throw new Error("Unknown AI tool.");
  const apiKey =
    cleanKey(apiKeyInput) || (await savedKey(shop, provider)).apiKey;
  if (!apiKey) throw new AiToolError("Enter an API key.", { kind: "auth" });
  return getAdapter(provider).listModels(apiKey);
}

/**
 * Verifies the key and model and saves them encrypted. Nothing is asked
 * until the merchant checks their selected prompts. A blank key keeps the
 * saved one (for changing the model).
 */
export async function connectTool(shop, { provider, apiKey, model }) {
  if (!getAiTool(provider)) throw new Error("Unknown AI tool.");
  const typedKey = cleanKey(apiKey);
  const saved = typedKey ? { apiKey: null } : await savedKey(shop, provider);
  const key = typedKey || saved.apiKey;
  if (!key) throw new AiToolError("Enter an API key.", { kind: "auth" });

  const adapter = getAdapter(provider);
  let chosenModel = String(model ?? "").trim();
  if (!chosenModel) chosenModel = (await adapter.listModels(key)).recommended;
  if (!chosenModel)
    throw new AiToolError("No usable models were found for this key.", {
      kind: "model",
    });
  await adapter.verifyModel(key, chosenModel);

  const data = {
    model: chosenModel,
    apiKey: encryptSecret(key),
    keyHint: keyHint(key),
    status: TOOL_STATUS.CONNECTED,
    lastError: null,
  };
  await prisma.aiTool.upsert({
    where: { shop_provider: { shop, provider } },
    create: { shop, provider, ...data },
    update: data,
  });
  return { model: chosenModel };
}

export async function disconnectTool(shop, provider) {
  await prisma.aiTool.deleteMany({ where: { shop, provider } });
}

async function markToolError(shop, provider, message) {
  await prisma.aiTool.updateMany({
    where: { shop, provider },
    data: { status: TOOL_STATUS.ERROR, lastError: message.slice(0, 300) },
  });
}

/** Connected tools with decrypted keys, optionally limited to `providers`. */
async function usableTools(shop, providers) {
  const rows = await prisma.aiTool.findMany({
    where: {
      shop,
      ...(providers?.length
        ? { provider: { in: providers } }
        : { status: TOOL_STATUS.CONNECTED }),
    },
  });
  const tools = [];
  for (const row of rows) {
    const apiKey = decryptSecret(row.apiKey);
    if (apiKey) {
      tools.push({ provider: row.provider, model: row.model, apiKey });
    } else {
      await markToolError(
        shop,
        row.provider,
        "The saved key can't be read. Enter it again.",
      );
    }
  }
  return AI_TOOLS.map((tool) =>
    tools.find((item) => item.provider === tool.id),
  ).filter(Boolean);
}

/**
 * Runs `task(adapter, tool)` with the first connected AI tool that succeeds,
 * in AI_TOOLS order. Tools failing with a key or billing error are marked.
 * @returns {Promise<{ result: any, provider: string, model: string }>}
 */
export async function runWithAiTool(shop, task, { label = "The AI request" } = {}) {
  const tools = await usableTools(shop);
  if (!tools.length) throw new Error("Connect an AI tool first, in AI tools.");
  const failures = [];
  for (const tool of tools) {
    try {
      const result = await task(getAdapter(tool.provider), tool);
      return { result, provider: tool.provider, model: tool.model };
    } catch (error) {
      console.error(`[geo] ${label} with ${tool.provider} failed for ${shop}`, error);
      failures.push(
        `${getAiTool(tool.provider)?.name ?? tool.provider}: ${error.message}`,
      );
      if (error instanceof AiToolError && error.blocksTool)
        await markToolError(shop, tool.provider, error.message);
    }
  }
  throw new Error(`${label} failed. ${failures.join(" ")}`);
}

export async function saveTrackSettings(shop, { answers }) {
  await updateStore(shop, { trackAnswers: clampAnswers(answers) });
}

// ─── Tracked domains ──────────────────────────────────────────────────────────

/** Domains that count as citations, and the store's own (the default). */
export async function getTrackDomains(shop) {
  const store = await getStore(shop);
  const defaults = storeDomains(store, shop);
  const domains = trackedDomains(store, shop);
  return {
    domains,
    defaults,
    custom: Boolean(store?.trackDomains),
  };
}

/**
 * Saves the domains typed by the merchant (empty resets to the store's own),
 * then re-checks saved answers against them. No AI requests are made.
 * @returns {Promise<{ domains: string[], rescored: number }>}
 */
export async function saveTrackDomains(shop, input) {
  const { domains, invalid } = parseDomainList(input);
  if (invalid.length)
    throw new Error(`Not a valid domain: ${invalid.slice(0, 3).join(", ")}`);
  if (domains.length > MAX_TRACK_DOMAINS)
    throw new Error(`Add up to ${MAX_TRACK_DOMAINS} domains.`);

  const store = await updateStore(shop, {
    trackDomains: domains.length ? JSON.stringify(domains) : null,
  });
  const rescored = await rescoreAnswers(shop, store);
  await refreshCitationWeeksSafely(shop);
  return { domains: trackedDomains(store, shop), rescored };
}

/** Re-checks saved answers from their stored text and sources. */
async function rescoreAnswers(shop, store) {
  const domains = trackedDomains(store, shop);
  const answers = await prisma.trackAnswer.findMany({
    where: { shop, error: null },
    select: {
      id: true,
      text: true,
      sources: true,
      cited: true,
      mentioned: true,
    },
  });

  const changed = answers
    .map((answer) => ({
      answer,
      result: analyzeAnswer(
        { text: answer.text, sources: parseJson(answer.sources, []) },
        { domains, brand: brandTerms(store) },
      ),
    }))
    .filter(
      ({ answer, result }) =>
        answer.cited !== result.cited || answer.mentioned !== result.mentioned,
    );

  if (changed.length) {
    await prisma.$transaction(
      changed.map(({ answer, result }) =>
        prisma.trackAnswer.update({ where: { id: answer.id }, data: result }),
      ),
    );
  }
  return changed.length;
}

// ─── Prompts ──────────────────────────────────────────────────────────────────

export function listPrompts(shop) {
  return prisma.trackPrompt.findMany({
    where: { shop },
    orderBy: [{ selected: "desc" }, { createdAt: "asc" }],
  });
}

/**
 * Adds prompts, all or none: the merchant's own (kind "custom") or ones an AI
 * tool wrote, which keep their kind and basis. Each is tracked while fewer
 * than TRACK.maxPrompts are, and archived after that.
 * @param {Array<{ text: string, kind?: string, basis?: string | null }>} items
 * @returns {Promise<Array<object>>} the new TrackPrompt rows, in order
 */
export async function addPrompts(shop, items) {
  const existing = await prisma.trackPrompt.findMany({ where: { shop } });
  const taken = new Set(existing.map((prompt) => prompt.text.toLowerCase()));
  let room =
    TRACK.maxPrompts - existing.filter((prompt) => prompt.selected).length;
  const rows = items.map((item) => {
    const text = cleanPromptText(item.text);
    if (text.length < 8)
      throw new Error("Write a question of at least 8 characters.");
    if (taken.has(text.toLowerCase()))
      throw new Error(
        items.length > 1
          ? `You already have the prompt “${text}”.`
          : "You already have this prompt.",
      );
    taken.add(text.toLowerCase());
    const selected = room > 0;
    if (selected) room -= 1;
    const kind = Object.hasOwn(PROMPT_KINDS, item.kind ?? "") ? item.kind : "custom";
    return {
      shop,
      text,
      kind,
      basis: kind === "custom" ? null : cleanPromptText(item.basis).slice(0, 120) || null,
      selected,
    };
  });
  return prisma.$transaction(
    rows.map((data) => prisma.trackPrompt.create({ data })),
  );
}

export async function addPrompt(shop, input) {
  const [prompt] = await addPrompts(shop, [{ text: input }]);
  return prompt;
}

export async function updatePrompt(shop, id, input) {
  const text = cleanPromptText(input);
  if (text.length < 8)
    throw new Error("Write a question of at least 8 characters.");
  // Answers to the old wording no longer apply.
  await prisma.$transaction([
    prisma.trackPrompt.updateMany({ where: { shop, id }, data: { text } }),
    prisma.trackAnswer.deleteMany({ where: { shop, promptId: id } }),
  ]);
}

export async function deletePrompt(shop, id) {
  await prisma.$transaction([
    prisma.trackPrompt.deleteMany({ where: { shop, id } }),
    prisma.trackAnswer.deleteMany({ where: { shop, promptId: id } }),
  ]);
}

export async function saveSelection(shop, ids) {
  const unique = [...new Set(ids)];
  if (unique.length > TRACK.maxPrompts)
    throw new Error(`Choose up to ${TRACK.maxPrompts} prompts.`);
  await prisma.$transaction([
    prisma.trackPrompt.updateMany({
      where: { shop, id: { notIn: unique } },
      data: { selected: false },
    }),
    prisma.trackPrompt.updateMany({
      where: { shop, id: { in: unique } },
      data: { selected: true },
    }),
  ]);
}

/** Whether any suggested (not custom) prompt has answers in the report. */
export async function suggestionsHaveAnswers(shop) {
  const suggested = await prisma.trackPrompt.findMany({
    where: { shop, kind: { not: "custom" } },
    select: { id: true },
  });
  if (!suggested.length) return false;
  const answers = await prisma.trackAnswer.count({
    where: { shop, promptId: { in: suggested.map((prompt) => prompt.id) } },
  });
  return answers > 0;
}

/** Tracked websites read for prompts, at most. */
const MAX_SITES_READ = 3;

/** What a tracked website's home page says it sells. Never throws. */
async function readSite(domain) {
  const page = await fetchStorefront(`https://${domain}/`, {
    timeoutMs: 10_000,
    retries: 1,
  });
  if (!page.ok || !/html/i.test(page.contentType)) return unreadSite(domain);
  return summarizeSite(page.text, domain);
}

/**
 * The request that writes prompts for the tracked domains: from the store's
 * catalog when they are the store's own, otherwise from the tracked
 * website's home page, so prompts match the site being measured.
 */
async function suggestionSource(shop, row, store) {
  const domains = trackedDomains(row, shop);
  if (tracksOtherSite(domains, storeDomains(row, shop))) {
    const sites = await mapLimit(
      domains.slice(0, MAX_SITES_READ),
      MAX_SITES_READ,
      readSite,
    );
    return {
      domains,
      basedOn: "website",
      sites,
      request: buildSiteSuggestionRequest({ sites }),
      fallback: () => siteSuggestions(sites[0]),
    };
  }
  const [products, collections] = await Promise.all([
    prisma.product.findMany({
      where: { shop, status: "ACTIVE", url: { not: null } },
    }),
    prisma.collection.findMany({ where: { shop } }),
  ]);
  const context = {
    store,
    domains,
    products: selectTopProducts(products, 15),
    collections: selectCollections(collections, 15),
  };
  return {
    domains,
    basedOn: "catalog",
    sites: [],
    request: buildSuggestionRequest(context),
    fallback: () => catalogSuggestions(context),
  };
}

/**
 * Asks the connected AI tools, in order, to write prompts for the tracked
 * domains (see suggestionSource) until one succeeds. Saves nothing.
 * `tools` is how many were tried; `failures` says why each one failed.
 */
async function writeSuggestions(shop) {
  const row = await getStore(shop);
  const view = toStoreView(row);
  if (!view) throw new Error("Sync your store first.");
  // Brand questions ("Is X a good place to buy…?") use the name set in settings.
  const store = { ...view, name: brandName(view) };
  const source = await suggestionSource(shop, row, store);

  let suggestions = [];
  let writtenBy = null;
  // In AI_TOOLS order, so Cursor's slow agents only write when others can't.
  const tools = await usableTools(shop);
  const failures = [];
  for (const tool of tools) {
    try {
      const result = await getAdapter(tool.provider).generateJson(
        tool.apiKey,
        tool.model,
        source.request,
      );
      suggestions = normalizeSuggestions(result);
      if (!suggestions.length)
        throw new Error("It returned no usable questions.");
      writtenBy = tool.provider;
      break;
    } catch (error) {
      console.error(`[geo] writing prompts failed for ${shop}`, error);
      failures.push(
        `${getAiTool(tool.provider)?.name ?? tool.provider}: ${error.message}`,
      );
      if (error instanceof AiToolError && error.blocksTool)
        await markToolError(shop, tool.provider, error.message);
    }
  }
  return { ...source, suggestions, writtenBy, failures, tools: tools.length };
}

/**
 * Prompts a connected AI tool writes for the tracked domains (the store's
 * catalog, or the website set as the Store URL in settings) for the merchant
 * to pick from. Nothing is saved; questions already tracked are left out.
 * @returns {Promise<{ suggestions: Array<{ text: string, kind: string, basis: string | null }>, writtenBy: string, domains: string[], basedOn: "catalog" | "website", unread: string[] }>}
 */
export async function suggestPrompts(shop) {
  const result = await writeSuggestions(shop);
  if (!result.tools) throw new Error("Connect an AI tool to write prompts.");
  if (!result.writtenBy)
    throw new Error(`Couldn't write prompts. ${result.failures.join(" ")}`);
  const existing = await prisma.trackPrompt.findMany({
    where: { shop },
    select: { text: true },
  });
  const taken = new Set(existing.map((prompt) => prompt.text.toLowerCase()));
  return {
    suggestions: result.suggestions.filter(
      (item) => !taken.has(item.text.toLowerCase()),
    ),
    writtenBy: result.writtenBy,
    domains: result.domains,
    basedOn: result.basedOn,
    unread: result.sites.filter((site) => !site.read).map((site) => site.domain),
  };
}

/**
 * Writes a fresh set of prompts for the tracked domain with a connected AI
 * tool (the next one is tried if one fails), or without one from the catalog
 * (or the tracked website's menu). Prompts follow the tracked domain: the
 * store's catalog for its own domain, the website's home page for another
 * site. Replaces every suggested prompt, selected or not, and their answers.
 * The merchant's own prompts are kept. New prompts start unselected. If every
 * connected tool fails, nothing changes.
 * @returns {Promise<{ count: number, writtenBy: string | null, domains: string[], basedOn: "catalog" | "website", unread: string[] }>}
 */
export async function regeneratePrompts(shop) {
  if (jobs.has(shop))
    throw new Error("Wait for the current check to finish, then regenerate.");
  const written = await writeSuggestions(shop);
  const { domains, basedOn, sites, fallback, writtenBy, failures, tools } = written;
  // Keep the current prompts rather than swap them for catalog templates.
  if (tools && !writtenBy)
    throw new Error(
      `Couldn't write new prompts, so nothing was changed. ${failures.join(" ")}`,
    );
  const suggestions = tools ? written.suggestions : fallback();

  const existing = await prisma.trackPrompt.findMany({ where: { shop } });
  const replacedIds = existing
    .filter((prompt) => prompt.kind !== "custom")
    .map((prompt) => prompt.id);
  const custom = new Set(
    existing
      .filter((prompt) => prompt.kind === "custom")
      .map((prompt) => prompt.text.toLowerCase()),
  );
  const fresh = suggestions.filter(
    (item) => !custom.has(item.text.toLowerCase()),
  );

  await prisma.$transaction([
    prisma.trackAnswer.deleteMany({
      where: { shop, promptId: { in: replacedIds } },
    }),
    prisma.trackPrompt.deleteMany({ where: { id: { in: replacedIds } } }),
    prisma.trackPrompt.createMany({
      data: fresh.map((item) => ({ shop, ...item, selected: false })),
    }),
  ]);
  return {
    count: fresh.length,
    writtenBy,
    domains,
    basedOn,
    unread: sites.filter((site) => !site.read).map((site) => site.domain),
  };
}

// ─── Runs ─────────────────────────────────────────────────────────────────────

export function parseTrackRun(run) {
  if (!run) return null;
  return {
    id: run.id,
    trigger: run.trigger,
    status: run.status,
    error: run.error,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    providers: parseJson(run.providers, []),
    progress: parseJson(run.progress, {}),
  };
}

export async function getLatestTrackRun(shop) {
  const run = await prisma.trackRun.findFirst({
    where: { shop },
    orderBy: { startedAt: "desc" },
  });
  const stale =
    run?.status === RUN_STATUS.RUNNING &&
    !jobs.has(shop) &&
    Date.now() - run.updatedAt.getTime() > STALE_MS;
  if (!stale) return run;
  return prisma.trackRun.update({
    where: { id: run.id },
    data: {
      status: RUN_STATUS.FAILED,
      error: "The check was interrupted. Run it again.",
      finishedAt: new Date(),
    },
  });
}

/**
 * Asks the selected prompts to every connected AI tool, unless a check is
 * already running for the shop. Only starts when the merchant asks for it
 * or the weekly check is due.
 * With `promptIds` only those selected prompts are asked, and with
 * `providers` only those AI tools (a check of one new prompt, say). Such a
 * partial check doesn't move the weekly schedule.
 * @param {string} shop
 * @param {{ trigger?: string, promptIds?: string[] | null, providers?: string[] | null }} [options]
 */
export async function startTrackRun(
  shop,
  { trigger = TRACK_TRIGGER.MANUAL, promptIds = null, providers = null } = {},
) {
  const latest = await getLatestTrackRun(shop);
  if (latest?.status === RUN_STATUS.RUNNING || jobs.has(shop)) return latest;

  // Reserve synchronously so a double submit can't start two runs.
  jobs.set(shop, null);
  let run;
  try {
    const selected = await prisma.trackPrompt.count({
      where: {
        shop,
        selected: true,
        ...(promptIds ? { id: { in: promptIds } } : {}),
      },
    });
    if (!selected) throw new Error("Select the prompts to check first.");
    const tools = await usableTools(shop, providers?.length ? providers : null);
    if (!tools.length) throw new Error("Connect an AI tool first.");
    run = await prisma.trackRun.create({
      data: {
        shop,
        trigger,
        providers: JSON.stringify(tools.map((tool) => tool.provider)),
        progress: JSON.stringify({ stage: "Starting", done: 0, total: 0 }),
      },
    });
  } catch (error) {
    jobs.delete(shop);
    throw error;
  }

  const job = executeRun(run, { promptIds })
    .catch(async (error) => {
      console.error(`[geo] tracking run ${run.id} for ${shop} failed`, error);
      await prisma.trackRun
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

async function executeRun(run, { promptIds = null } = {}) {
  const { shop } = run;
  const save = (data) =>
    prisma.trackRun.update({ where: { id: run.id }, data });
  const setProgress = (progress) =>
    save({ progress: JSON.stringify(progress) });

  const store = toStoreView(await getStore(shop));
  if (!store) throw new Error("Store not found.");

  // Only the prompts the merchant selected, never more than the limit.
  const prompts = await prisma.trackPrompt.findMany({
    where: {
      shop,
      selected: true,
      ...(promptIds ? { id: { in: promptIds } } : {}),
    },
    orderBy: { createdAt: "asc" },
    take: TRACK.maxPrompts,
  });
  if (!prompts.length) throw new Error("Select the prompts to check first.");

  const tools = await usableTools(shop, parseJson(run.providers, []));
  if (!tools.length) throw new Error("Connect an AI tool first.");

  const answers = clampAnswers(store.trackAnswers);
  const domains = trackedDomains(store, shop);
  const total = tools.length * prompts.length * answers;
  const stopped = new Map();
  const tally = { answered: 0, cited: 0, failed: 0 };
  const startedAt = Date.now();
  let done = 0;
  let writtenAt = 0;

  console.info(
    `[geo:track] Check started for ${shop} (${run.trigger}) · prompts: ${prompts.length} · tools: ${tools.map((tool) => getAiTool(tool.provider)?.name ?? tool.provider).join(", ")} · answers per prompt: ${answers} · requests: ${total}`,
  );

  const tick = () => {
    done += 1;
    if (Date.now() - writtenAt < PROGRESS_WRITE_MS && done !== total) return;
    writtenAt = Date.now();
    setProgress({ stage: "Asking AI tools", done, total }).catch(() => {});
  };

  await setProgress({ stage: "Asking AI tools", done: 0, total });

  await Promise.all(
    tools.map((tool) => {
      const tasks = prompts.flatMap((prompt) =>
        Array.from({ length: answers }, () => prompt),
      );
      const limit =
        getAdapter(tool.provider).concurrency ?? TRACK.concurrencyPerTool;
      return mapLimit(tasks, limit, async (prompt) => {
        try {
          // A rejected key or empty account stops the tool for this run.
          if (stopped.has(tool.provider)) return;
          const base = {
            shop,
            runId: run.id,
            promptId: prompt.id,
            provider: tool.provider,
            model: tool.model,
          };
          try {
            const reply = await getAdapter(tool.provider).ask(
              tool.apiKey,
              tool.model,
              prompt.text,
              { country: store.country },
            );
            const answer = {
              ...reply,
              sources: await resolveStoreRedirects(
                reply.sources.slice(0, MAX_SOURCES),
                domains,
              ),
            };
            const { cited, mentioned } = analyzeAnswer(answer, {
              domains,
              brand: brandTerms(store),
            });
            await prisma.trackAnswer.create({
              data: {
                ...base,
                cited,
                mentioned,
                sources: JSON.stringify(answer.sources),
                text: answer.text.slice(0, MAX_ANSWER_CHARS),
              },
            });
            tally.answered += 1;
            if (cited) tally.cited += 1;
            console.info(
              `[geo:track] ${getAiTool(tool.provider)?.name ?? tool.provider} · "${prompt.text}" · ${cited ? "cites your store" : mentioned ? "mentions you, no link" : "not cited"}`,
            );
          } catch (error) {
            if (error instanceof AiToolError && error.blocksTool) {
              if (!stopped.has(tool.provider)) {
                stopped.set(tool.provider, error.message);
                await markToolError(shop, tool.provider, error.message);
              }
              return;
            }
            tally.failed += 1;
            await prisma.trackAnswer.create({
              data: { ...base, error: String(error.message).slice(0, 300) },
            });
          }
        } finally {
          tick();
        }
      });
    }),
  );

  const stoppedNames = [...stopped.keys()].map(
    (provider) => getAiTool(provider)?.name ?? provider,
  );
  console.info(
    `[geo:track] Check finished for ${shop} in ${Math.round((Date.now() - startedAt) / 1000)}s: ${tally.answered} answers, ${tally.cited} cite your store, ${tally.failed} failed${stoppedNames.length ? `, stopped: ${stoppedNames.join(", ")}` : ""}`,
  );
  await save({
    status: RUN_STATUS.COMPLETED,
    finishedAt: new Date(),
    error: stoppedNames.length
      ? `${stoppedNames.join(", ")} stopped: check the API key and account credit.`
      : null,
    progress: JSON.stringify({ stage: "Done", done: total, total }),
  });

  // A check of some prompts only doesn't postpone the weekly check of the rest.
  if (!promptIds)
    await updateStore(shop, {
      trackNextRunAt: addDays(new Date(), TRACK.intervalDays),
    });
  await pruneHistory(shop);
  await refreshCitationWeeksSafely(shop);
}

/**
 * Gemini sources are Google redirect links whose title is the site's domain.
 * For links to the store, the redirect is followed once (without loading the
 * page) so the cited page is known. Other sources are kept as they are.
 */
async function resolveStoreRedirects(sources, domains) {
  return Promise.all(
    sources.map(async (source) => {
      if (
        !isGoogleRedirect(source.url) ||
        !matchesDomain(normalizeHost(source.title), domains)
      )
        return source;
      try {
        const response = await fetch(source.url, {
          redirect: "manual",
          signal: AbortSignal.timeout(REDIRECT_TIMEOUT_MS),
        });
        await response.body?.cancel();
        const location = response.headers.get("location");
        if (!location) return source;
        const target = new URL(location, source.url).toString();
        return matchesDomain(normalizeHost(target), domains)
          ? { ...source, url: target }
          : source;
      } catch {
        return source;
      }
    }),
  );
}

async function pruneHistory(shop) {
  const keepRuns = await prisma.trackRun.findMany({
    where: { shop },
    orderBy: { startedAt: "desc" },
    take: KEEP_RUNS,
    select: { id: true },
  });
  await prisma.$transaction([
    prisma.trackAnswer.deleteMany({
      where: {
        shop,
        createdAt: { lt: addDays(new Date(), -7 * TRACK.keepWeeks) },
      },
    }),
    prisma.trackRun.deleteMany({
      where: { shop, id: { notIn: keepRuns.map((run) => run.id) } },
    }),
  ]);
}

// ─── Weekly schedule ──────────────────────────────────────────────────────────

/** Starts the weekly runs that are due. Called by the scheduler. */
export async function runDueTracking() {
  const due = await prisma.store.findMany({
    where: { trackNextRunAt: { lte: new Date() } },
    select: { shop: true, settings: true },
    orderBy: { trackNextRunAt: "asc" },
    take: 20,
  });
  for (const { shop, settings } of due) {
    if (jobs.size >= MAX_PARALLEL_RUNS) break;
    if (jobs.has(shop)) continue;
    if (parseJson(settings, {}).weeklyTracking === false) {
      await updateStore(shop, { trackNextRunAt: null });
      continue;
    }
    const [tools, prompts] = await Promise.all([
      prisma.aiTool.count({
        where: { shop, status: TOOL_STATUS.CONNECTED },
      }),
      prisma.trackPrompt.count({ where: { shop, selected: true } }),
    ]);
    if (!tools || !prompts) {
      await updateStore(shop, { trackNextRunAt: null });
      continue;
    }
    await startTrackRun(shop, { trigger: TRACK_TRIGGER.WEEKLY }).catch(
      (error) => console.error(`[geo] weekly run failed for ${shop}`, error),
    );
  }
}

export function ensureTrackScheduler() {
  if (global.__geoTrackScheduler) return;
  const tick = () => {
    runDueTracking().catch((error) =>
      console.error("[geo] tracking schedule failed", error),
    );
    runDueAudits().catch((error) =>
      console.error("[geo] audit schedule failed", error),
    );
  };
  global.__geoTrackScheduler = setInterval(tick, SCHEDULER_MS);
  global.__geoTrackScheduler.unref?.();
  setTimeout(tick, 30_000).unref?.();
}

/** Overview for the AI tools page: settings, selection size and weekly cost. */
export async function getTrackOverview(shop) {
  const [store, selected, connected, runRow] = await Promise.all([
    getStore(shop),
    prisma.trackPrompt.count({ where: { shop, selected: true } }),
    prisma.aiTool.count({ where: { shop, status: TOOL_STATUS.CONNECTED } }),
    getLatestTrackRun(shop),
  ]);
  const answers = clampAnswers(store?.trackAnswers ?? TRACK.defaultAnswers);
  return {
    answers,
    selectedPrompts: selected,
    connectedTools: connected,
    weeklyRequests: selected * connected * answers,
    nextRunAt: store?.trackNextRunAt ?? null,
    run: parseTrackRun(runRow),
    domains: trackedDomains(store, shop),
  };
}

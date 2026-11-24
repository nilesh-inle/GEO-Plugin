/**
 * AI citation tracking: for each AI answer, whether it cites the store, which
 * store pages it links to and which other sites it cites, plus weekly totals
 * for the trend. Pure functions over saved answers (TrackAnswer rows with
 * `sources` already parsed), so reports can be tested without a database.
 *
 * Definitions used throughout:
 *   citation       an answer that links to the store's domain or writes it
 *                  out (TrackAnswer.cited). One answer counts once.
 *   page citation  one answer linking to one store page. An answer linking to
 *                  three pages counts once for each page.
 *   competitor     a watched competitor with a website; it's cited when an
 *                  answer links to or writes out that domain.
 */
import { AI_TOOL_IDS, getAiTool } from "./aiTools";
import {
  analyzeAnswer,
  isGoogleRedirect,
  matchesDomain,
  mentionsName,
  normalizeHost,
  siteType,
  sourceHost,
} from "./citations";

const DAY_MS = 86_400_000;
const WEEK_MS = 7 * DAY_MS;

/** Rate in percent with a 95% margin (normal approximation), or nulls when n = 0. */
export function rate(part, total) {
  if (!total) return { value: null, margin: null, part, total };
  const p = part / total;
  const margin = 1.96 * Math.sqrt((p * (1 - p)) / total);
  return {
    value: Math.round(p * 100),
    margin: Math.max(1, Math.round(margin * 100)),
    part,
    total,
  };
}

/** Change in percentage points, or null when either side has no answers. */
export function rateDelta(current, previous) {
  return current?.value != null && previous?.value != null
    ? current.value - previous.value
    : null;
}

const providerName = (id) => getAiTool(id)?.name ?? id;

// ─── Store URLs ───────────────────────────────────────────────────────────────

// Shopify Markets language/country prefix: /fr, /en-ca, /zh-hant
const LOCALE_SEGMENT = /^[a-z]{2}(-[a-z]{2,4})?$/;
const SHOPIFY_ROOTS = new Set(["products", "collections", "blogs", "pages", "policies"]);

function decodeSegment(segment) {
  try {
    return decodeURIComponent(segment).toLowerCase();
  } catch {
    return segment.toLowerCase();
  }
}

/**
 * The page a store path points to, normalized so the same page always has
 * the same key: no query, locale prefix or trailing slash, and products
 * opened from a collection (/collections/x/products/y) count as the product.
 * @returns {{ path: string, type: string, handle: string|null }}
 */
export function classifyStorePath(pathname) {
  let segments = String(pathname || "/")
    .split("?")[0]
    .split("#")[0]
    .split("/")
    .filter(Boolean)
    .map(decodeSegment);
  if (
    segments.length > 1 &&
    LOCALE_SEGMENT.test(segments[0]) &&
    SHOPIFY_ROOTS.has(segments[1])
  )
    segments = segments.slice(1);
  if (!segments.length || (segments.length === 1 && LOCALE_SEGMENT.test(segments[0])))
    return { path: "/", type: "home", handle: null };

  const [root, first, second, third] = segments;
  if (root === "products" && first)
    return { path: `/products/${first}`, type: "product", handle: first };
  if (root === "collections" && first) {
    if (second === "products" && third)
      return { path: `/products/${third}`, type: "product", handle: third };
    return { path: `/collections/${first}`, type: "collection", handle: first };
  }
  if (root === "blogs" && first) {
    if (second && second !== "tagged")
      return { path: `/blogs/${first}/${second}`, type: "article", handle: second };
    return { path: `/blogs/${first}`, type: "blog", handle: first };
  }
  if (root === "pages" && first)
    return { path: `/pages/${first}`, type: "page", handle: first };
  if (root === "policies" && first)
    return { path: `/policies/${first}`, type: "policy", handle: first };
  return { path: `/${segments.join("/")}`, type: "other", handle: null };
}

/** A source's page title, unless it's only a domain or a URL. */
function sourceTitle(source) {
  const title = String(source?.title ?? "").replace(/\s+/g, " ").trim();
  if (!title || /^https?:\/\//i.test(title) || /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(title))
    return "";
  return title.slice(0, 140);
}

/**
 * Store pages an answer links to, one entry per page. A Gemini link that
 * couldn't be resolved still shows (from its title) that it's the store's
 * site, but not which page: it's returned once with `path: null`.
 * @param {Array<{ url: string, title?: string }>} sources
 * @param {string[]} domains the store's domains
 */
export function storeLinks(sources, domains) {
  const pages = new Map();
  for (const source of sources ?? []) {
    if (!source?.url) continue;
    if (isGoogleRedirect(source.url)) {
      if (matchesDomain(normalizeHost(source.title), domains) && !pages.has(null))
        pages.set(null, { path: null, type: "unknown", handle: null, title: "" });
      continue;
    }
    if (!matchesDomain(normalizeHost(source.url), domains)) continue;
    let pathname;
    try {
      pathname = new URL(source.url).pathname;
    } catch {
      continue;
    }
    const page = classifyStorePath(pathname);
    if (!pages.has(page.path)) pages.set(page.path, { ...page, title: sourceTitle(source) });
  }
  return [...pages.values()];
}

/** Watched competitors (with a website) that an answer links to or writes out. */
export function citedCompetitors(answer, competitors) {
  return competitors.filter(
    (competitor) =>
      competitor.domain &&
      analyzeAnswer(
        { text: answer.text, sources: answer.sources ?? [] },
        { domains: [competitor.domain] },
      ).cited,
  );
}

function increment(map, key, by = 1) {
  map.set(key, (map.get(key) ?? 0) + by);
}

// ─── Weekly snapshots ─────────────────────────────────────────────────────────

/** Monday 00:00 UTC of the week a date falls in. */
export function weekStart(value) {
  const date = new Date(value);
  const sinceMonday = (date.getUTCDay() + 6) % 7;
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() - sinceMonday),
  );
}

/**
 * Weekly totals per AI tool, saved as CitationWeek rows so trends outlast
 * the answers themselves (answers are deleted after a few weeks).
 * @param {Array} answers { provider, cited, mentioned, text, sources: [], createdAt }
 */
export function summarizeWeeks(answers, { domains, competitors = [] }) {
  const watched = competitors.filter((competitor) => competitor.domain);
  const groups = new Map();
  for (const answer of answers) {
    const start = weekStart(answer.createdAt);
    const key = `${start.toISOString()}|${answer.provider}`;
    const row = groups.get(key) ?? {
      weekStart: start,
      provider: answer.provider,
      answers: 0,
      cited: 0,
      mentioned: 0,
      links: 0,
      competitors: {},
    };
    row.answers += 1;
    if (answer.cited) row.cited += 1;
    if (answer.cited || answer.mentioned) row.mentioned += 1;
    row.links += storeLinks(answer.sources, domains).length;
    for (const competitor of citedCompetitors(answer, watched))
      row.competitors[competitor.domain] = (row.competitors[competitor.domain] ?? 0) + 1;
    groups.set(key, row);
  }
  return [...groups.values()];
}

// ─── Prompts: the table and one prompt's details ──────────────────────────────

/**
 * What one answer adds to its prompt's counts.
 *   domainCitations  links to the store's pages; a store only named in the
 *                    text (no link) counts once
 *   totalCitations   every source the answer links to
 */
function answerFacts(answer, domains, watched) {
  const sources = answer.sources ?? [];
  const links = storeLinks(sources, domains).length;
  const written = answer.cited && !links ? 1 : 0;
  return {
    sources,
    domainCitations: links + written,
    totalCitations: sources.length + written,
    rivals: citedCompetitors({ text: answer.text, sources }, watched),
  };
}

const byToolOrder = (a, b) => AI_TOOL_IDS.indexOf(a) - AI_TOOL_IDS.indexOf(b);

/**
 * One row per prompt for the citation table: how many answers named or cited
 * the store, how many store pages and other sources they linked to, and which
 * watched competitors were cited.
 * @param {object} input
 * @param {Array} input.answers  { promptId, provider, cited, mentioned, text, sources: [], createdAt }
 * @param {Array<{ id: string, text: string, kind?: string, selected?: boolean }>} input.prompts
 * @param {string[]} input.domains the store's domains
 * @param {Array<{ name: string, domain?: string|null }>} input.competitors
 */
export function buildPromptRows({ answers = [], prompts = [], domains = [], competitors = [] }) {
  const watched = competitors.filter((competitor) => competitor.domain);
  const rows = new Map(
    prompts.map((prompt) => [
      prompt.id,
      {
        id: prompt.id,
        text: prompt.text,
        kind: prompt.kind ?? "custom",
        selected: Boolean(prompt.selected),
        answers: 0,
        mentioned: 0,
        cited: 0,
        domainCitations: 0,
        totalCitations: 0,
        providers: new Set(),
        rivals: new Map(),
        lastAt: null,
      },
    ]),
  );

  for (const answer of answers) {
    const row = rows.get(answer.promptId);
    if (!row) continue;
    const facts = answerFacts(answer, domains, watched);
    row.answers += 1;
    if (answer.cited || answer.mentioned) row.mentioned += 1;
    if (answer.cited) row.cited += 1;
    row.domainCitations += facts.domainCitations;
    row.totalCitations += facts.totalCitations;
    row.providers.add(answer.provider);
    for (const rival of facts.rivals) increment(row.rivals, rival.name);
    const at = new Date(answer.createdAt);
    if (!row.lastAt || at > row.lastAt) row.lastAt = at;
  }

  return [...rows.values()].map((row) => ({
    id: row.id,
    text: row.text,
    kind: row.kind,
    selected: row.selected,
    answers: row.answers,
    mentioned: row.mentioned,
    cited: row.cited,
    domainCitations: row.domainCitations,
    totalCitations: row.totalCitations,
    coverage: rate(row.mentioned, row.answers),
    citationRate: rate(row.cited, row.answers),
    providers: [...row.providers].sort(byToolOrder),
    competitors: [...row.rivals]
      .map(([name, count]) => ({ name, answers: count }))
      .sort((a, b) => b.answers - a.answers),
    lastAt: row.lastAt,
  }));
}

/** The same page always gets the same key: no fragment, no utm_* parameters, no trailing slash. */
function sourceKey(source, host) {
  if (isGoogleRedirect(source.url)) return `hidden:${host}`;
  try {
    const url = new URL(source.url);
    for (const name of [...url.searchParams.keys()])
      if (name.startsWith("utm_")) url.searchParams.delete(name);
    return `${host}${url.pathname.replace(/\/$/, "")}${url.search}`.toLowerCase();
  } catch {
    return source.url;
  }
}

/** A source as the details screen shows it. */
function displaySource(source, { domains, watched }) {
  const host = sourceHost(source) ?? "";
  const rival = watched.find((competitor) => matchesDomain(host, [competitor.domain]));
  return {
    key: sourceKey(source, host),
    url: source.url,
    hidden: isGoogleRedirect(source.url),
    host,
    title: sourceTitle(source),
    isStore: matchesDomain(host, domains),
    competitor: rival?.name ?? null,
  };
}

const HISTORY_MIN_WEEKS = 4;
const HISTORY_MAX_WEEKS = 9;
const MAX_RESPONSES = 100;
const MAX_CITATIONS = 300;

/** Brand coverage per week, oldest first, for the weeks the period touches. */
function weeklyCoverage(answers, { days, now }) {
  const weeks = Math.min(
    HISTORY_MAX_WEEKS,
    Math.max(HISTORY_MIN_WEEKS, Math.ceil(days / 7) + 1),
  );
  const current = weekStart(now).getTime();
  const starts = Array.from({ length: weeks }, (_, index) => current - (weeks - 1 - index) * WEEK_MS);
  const buckets = starts.map(() => ({ answers: 0, mentioned: 0, cited: 0 }));
  for (const answer of answers) {
    const index = Math.round((weekStart(answer.createdAt).getTime() - starts[0]) / WEEK_MS);
    const bucket = buckets[index];
    if (!bucket) continue;
    bucket.answers += 1;
    if (answer.cited || answer.mentioned) bucket.mentioned += 1;
    if (answer.cited) bucket.cited += 1;
  }
  return starts.map((start, index) => ({
    start: new Date(start),
    ...buckets[index],
    coverage: rate(buckets[index].mentioned, buckets[index].answers),
  }));
}

/**
 * Everything the prompt details screen shows: totals, how the store ranks
 * against watched competitors, brand coverage by week, every answer, and the
 * pages those answers cite.
 * @param {object} input
 * @param {{ id: string, text: string, kind?: string, selected?: boolean }} input.prompt
 * @param {Array} input.answers  newest first: { id, provider, model, cited, mentioned, text, sources: [], createdAt }
 * @param {string[]} input.domains the store's domains
 * @param {Array<{ name: string, domain?: string|null }>} input.competitors
 * @param {string} input.storeName
 * @param {number} input.days the period shown, for the weekly chart
 */
export function buildPromptDetail({
  prompt,
  answers = [],
  domains = [],
  competitors = [],
  storeName = "",
  days = 28,
  now = new Date(),
}) {
  const watched = competitors.filter((competitor) => competitor.domain);
  const rivals = new Map(
    competitors
      .filter((competitor) => competitor.name)
      .map((competitor) => [
        competitor.name,
        { name: competitor.name, domain: competitor.domain || null, mentions: 0, citations: 0 },
      ]),
  );
  const pages = new Map();
  const responses = [];
  const engines = new Set();
  let mentioned = 0;
  let cited = 0;
  let domainCitations = 0;
  let totalCitations = 0;

  for (const answer of answers) {
    const facts = answerFacts(answer, domains, watched);
    const named = Boolean(answer.cited || answer.mentioned);
    const sources = facts.sources.map((source) => displaySource(source, { domains, watched }));
    const citedByRival = new Set(facts.rivals.map((rival) => rival.name));

    engines.add(answer.provider);
    if (named) mentioned += 1;
    if (answer.cited) cited += 1;
    domainCitations += facts.domainCitations;
    totalCitations += facts.totalCitations;

    for (const rival of rivals.values()) {
      const isCited = citedByRival.has(rival.name);
      if (isCited) rival.citations += 1;
      if (isCited || mentionsName(answer.text, rival.name)) rival.mentions += 1;
    }

    // One count per page per answer.
    for (const source of new Map(sources.map((item) => [item.key, item])).values()) {
      const page = pages.get(source.key) ?? {
        key: source.key,
        url: source.hidden ? null : source.url,
        title: source.title,
        host: source.host,
        hidden: source.hidden,
        category: source.isStore
          ? "Your store"
          : source.competitor
            ? "Competitor"
            : siteType(source.host),
        competitor: source.competitor,
        cited: 0,
        engines: new Set(),
      };
      page.cited += 1;
      page.engines.add(answer.provider);
      pages.set(source.key, page);
    }

    if (responses.length < MAX_RESPONSES)
      responses.push({
        id: answer.id,
        provider: answer.provider,
        platform: providerName(answer.provider),
        model: answer.model,
        createdAt: answer.createdAt,
        text: answer.text,
        mentioned: named,
        cited: Boolean(answer.cited),
        competitors: [...citedByRival],
        sources: sources.map(({ key, ...source }) => source), // eslint-disable-line no-unused-vars
      });
  }

  const total = answers.length;
  const ranking = [
    {
      key: "store",
      name: storeName || domains[0] || "Your store",
      domain: domains[0] ?? null,
      you: true,
      mentions: mentioned,
      citations: cited,
    },
    ...[...rivals.values()].map((rival) => ({
      key: `rival:${rival.name}`,
      ...rival,
      you: false,
    })),
  ]
    .map((entry) => ({ ...entry, coverage: rate(entry.mentions, total) }))
    .sort(
      (a, b) =>
        b.citations - a.citations ||
        b.mentions - a.mentions ||
        Number(b.you) - Number(a.you),
    );

  return {
    prompt: {
      id: prompt.id,
      text: prompt.text,
      kind: prompt.kind ?? "custom",
      selected: Boolean(prompt.selected),
    },
    days,
    totals: {
      answers: total,
      mentioned,
      cited,
      domainCitations,
      totalCitations,
      coverage: rate(mentioned, total),
      citationRate: rate(cited, total),
      watchedCompetitors: watched.length,
      competitorsCited: [...rivals.values()].filter((rival) => rival.citations).length,
    },
    engines: [...engines].sort(byToolOrder),
    ranking,
    history: weeklyCoverage(answers, { days, now }),
    responses,
    citations: [...pages.values()]
      .map((page) => ({ ...page, engines: [...page.engines].sort(byToolOrder) }))
      .sort((a, b) => b.cited - a.cited || a.host.localeCompare(b.host))
      .slice(0, MAX_CITATIONS),
  };
}

// ─── Visibility breakdown: engines, competitors and cited sources ─────────────

const MAX_SOURCES = 50;
const MAX_SOURCE_URLS = 5;
const MAX_BRAND_PAGES = 25;

/** A link without its #fragment, so the same page counts once. */
function pageUrl(url) {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return url;
  }
}

const rivalKey = (name) => `rival:${name}`;

/**
 * One URL per page: no #fragment, utm_* parameters, "www." or trailing
 * slash, so links to the same page from different answers add up.
 */
function canonicalPageUrl(url) {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    for (const name of [...parsed.searchParams.keys()])
      if (name.startsWith("utm_")) parsed.searchParams.delete(name);
    parsed.hostname = parsed.hostname.replace(/^www\./, "");
    if (parsed.pathname.length > 1) parsed.pathname = parsed.pathname.replace(/\/+$/, "");
    return parsed.toString();
  } catch {
    return url;
  }
}

/**
 * Records the pages of the store and of each competitor with a website that
 * one answer links to. A page counts once per answer, at its first position
 * among the answer's sources (1 = first). A Gemini link names only the site,
 * so it's kept as one page with `url: null`.
 * @param {Map} linked owner key → { answers, pages: Map<url, page> }
 * @param {Array<{ key: string, domains: string[] }>} owners the store first
 */
function tallyLinkedPages(linked, owners, answer) {
  const seen = new Set();
  const owned = new Set();
  (answer.sources ?? []).forEach((source, index) => {
    const host = sourceHost(source);
    const owner = host && owners.find((item) => matchesDomain(host, item.domains));
    if (!owner) return;
    const url = isGoogleRedirect(source.url) ? null : canonicalPageUrl(source.url);
    const id = `${owner.key} ${url}`;
    if (seen.has(id)) return;
    seen.add(id);
    owned.add(owner.key);
    const pages = linked.get(owner.key).pages;
    const page = pages.get(url) ?? { url, answers: 0, positions: 0, engines: new Set() };
    page.answers += 1;
    page.positions += index + 1;
    page.engines.add(answer.provider);
    pages.set(url, page);
  });
  for (const key of owned) linked.get(key).answers += 1;
}

/** An owner's linked pages for display, most linked first; a hidden page last. */
function linkedPages(tally) {
  if (!tally) return { linked: 0, pages: [] };
  return {
    linked: tally.answers,
    pages: [...tally.pages.values()]
      .map((page) => ({
        url: page.url,
        answers: page.answers,
        position: Math.round((page.positions / page.answers) * 10) / 10,
        engines: [...page.engines].sort(byToolOrder),
      }))
      .sort(
        (a, b) =>
          Number(a.url === null) - Number(b.url === null) ||
          b.answers - a.answers ||
          a.position - b.position ||
          String(a.url).localeCompare(String(b.url)),
      )
      .slice(0, MAX_BRAND_PAGES),
  };
}

/**
 * The three lists under the summary cards, for a set of answers:
 *   engines  per AI engine, the answers that named the store
 *   voices   the store and each watched competitor, by answers naming them,
 *            each with the answers linking to its site (`linked`) and those
 *            pages (`pages`: answers, average position, engines)
 *   sources  the sites the answers link to, by answers citing them, each
 *            with its most cited pages (Gemini hides the exact page)
 * @param {object} input
 * @param {Array} input.answers  { provider, cited, mentioned, text, sources: [] }
 * @param {string[]} input.domains the store's domains
 * @param {Array<{ name: string, domain?: string|null }>} input.competitors
 * @param {string} input.storeName
 */
export function buildVisibilityBreakdown({ answers = [], domains = [], competitors = [], storeName = "" }) {
  const total = answers.length;
  const engines = new Map();
  const sites = new Map();
  const rivals = new Map(
    competitors.filter((competitor) => competitor.name).map((competitor) => [competitor.name, 0]),
  );
  const rivalDomain = (name) =>
    competitors.find((competitor) => competitor.name === name)?.domain || null;
  // Whose pages are tracked: the store (first, so it wins a shared domain)
  // and each competitor with a website.
  const owners = [
    { key: "store", domains },
    ...[...rivals.keys()]
      .filter(rivalDomain)
      .map((name) => ({ key: rivalKey(name), domains: [rivalDomain(name)] })),
  ];
  const linked = new Map(owners.map((owner) => [owner.key, { answers: 0, pages: new Map() }]));
  let named = 0;

  for (const answer of answers) {
    const sources = answer.sources ?? [];
    const isNamed = Boolean(answer.cited || answer.mentioned);
    if (isNamed) named += 1;

    const engine = engines.get(answer.provider) ?? { id: answer.provider, answers: 0, mentioned: 0 };
    engine.answers += 1;
    if (isNamed) engine.mentioned += 1;
    engines.set(answer.provider, engine);

    const cited = new Set(
      citedCompetitors({ text: answer.text, sources }, competitors).map((rival) => rival.name),
    );
    for (const name of rivals.keys())
      if (cited.has(name) || mentionsName(answer.text, name)) rivals.set(name, rivals.get(name) + 1);

    tallyLinkedPages(linked, owners, answer);

    // Each site counts once per answer, however many of its pages are linked.
    const hosts = new Map();
    for (const source of sources) {
      const host = sourceHost(source);
      if (!host) continue;
      const urls = hosts.get(host) ?? new Set();
      if (source.url && !isGoogleRedirect(source.url)) urls.add(pageUrl(source.url));
      hosts.set(host, urls);
    }
    for (const [host, urls] of hosts) {
      const site = sites.get(host) ?? {
        host,
        answers: 0,
        engines: new Set(),
        urls: new Map(),
        isStore: matchesDomain(host, domains),
      };
      site.answers += 1;
      site.engines.add(answer.provider);
      for (const url of urls) site.urls.set(url, (site.urls.get(url) ?? 0) + 1);
      sites.set(host, site);
    }
  }

  return {
    total,
    engines: [...engines.values()]
      .map((engine) => ({ ...engine, rate: rate(engine.mentioned, engine.answers) }))
      .sort((a, b) => b.mentioned - a.mentioned || b.answers - a.answers || byToolOrder(a.id, b.id)),
    voices: [
      {
        key: "store",
        name: storeName || domains[0] || "Your store",
        domain: domains[0] ?? null,
        you: true,
        answers: named,
      },
      ...[...rivals].map(([name, count]) => ({
        key: rivalKey(name),
        name,
        domain: rivalDomain(name),
        you: false,
        answers: count,
      })),
    ]
      .map((entry) => ({
        ...entry,
        rate: rate(entry.answers, total),
        ...linkedPages(linked.get(entry.key)),
      }))
      .sort((a, b) => b.answers - a.answers || Number(b.you) - Number(a.you) || a.name.localeCompare(b.name)),
    sources: [...sites.values()]
      .sort((a, b) => b.answers - a.answers || a.host.localeCompare(b.host))
      .slice(0, MAX_SOURCES)
      .map((site) => ({
        host: site.host,
        answers: site.answers,
        share: rate(site.answers, total),
        isStore: site.isStore,
        engines: [...site.engines].sort(byToolOrder),
        urls: [...site.urls]
          .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
          .slice(0, MAX_SOURCE_URLS)
          .map(([url, count]) => ({ url, answers: count })),
      })),
  };
}

// ─── Visibility summary: the cards above the prompt table ─────────────────────

/** Counts for a set of answers: brand mentions, competitor mentions, link positions. */
function visibilityStats(answers, { domains, competitors }) {
  const counts = new Map(
    competitors.filter((competitor) => competitor.name).map((competitor) => [competitor.name, 0]),
  );
  let named = 0;
  let positions = 0;
  let ranked = 0;

  for (const answer of answers) {
    const sources = answer.sources ?? [];
    if (answer.cited || answer.mentioned) named += 1;

    const cited = new Set(
      citedCompetitors({ text: answer.text, sources }, competitors).map((rival) => rival.name),
    );
    for (const name of counts.keys())
      if (cited.has(name) || mentionsName(answer.text, name)) counts.set(name, counts.get(name) + 1);

    // Where the first link to the store sits among the answer's sources.
    const index = sources.findIndex((source) => matchesDomain(sourceHost(source) ?? "", domains));
    if (index >= 0) {
      positions += index + 1;
      ranked += 1;
    }
  }

  const rivalTotal = [...counts.values()].reduce((sum, count) => sum + count, 0);
  const voiceTotal = named + rivalTotal;
  return {
    answers: answers.length,
    mention: rate(named, answers.length),
    voice: {
      // Only meaningful next to competitors.
      value: counts.size && voiceTotal ? Math.round((named / voiceTotal) * 100) : null,
      brand: named,
      total: voiceTotal,
    },
    rank: {
      value: ranked ? Math.round((positions / ranked) * 10) / 10 : null,
      samples: ranked,
    },
    competitors: [...counts]
      .map(([name, count]) => ({
        name,
        domain: competitors.find((competitor) => competitor.name === name)?.domain || null,
        answers: count,
        share: rate(count, answers.length),
      }))
      .sort((a, b) => b.answers - a.answers || a.name.localeCompare(b.name)),
  };
}

/**
 * The four cards of the AI visibility page, for the period and the one before.
 *   mention  share of answers that name or link to the store
 *   voice    the store's mentions as a share of its and its competitors' mentions
 *   rank     average position of the store among an answer's sources, when linked
 *   top      the competitors named in most answers
 * @param {object} input
 * @param {Array} input.answers  { cited, mentioned, text, sources: [] } in the period
 * @param {Array} input.previous the same, in the period before
 * @param {string[]} input.domains the store's domains
 * @param {Array<{ name: string, domain?: string|null }>} input.competitors watched competitors
 */
export function buildVisibilitySummary({ answers = [], previous = [], domains = [], competitors = [] }) {
  const current = visibilityStats(answers, { domains, competitors });
  const before = visibilityStats(previous, { domains, competitors });
  return {
    answers: current.answers,
    mention: current.mention,
    voice: current.voice,
    rank: current.rank,
    top: current.competitors.slice(0, 3),
    watched: current.competitors.length,
    previous: {
      answers: before.answers,
      mention: before.mention,
      voice: before.voice,
      rank: before.rank,
    },
  };
}

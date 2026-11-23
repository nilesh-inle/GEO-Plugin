/**
 * AI visibility statistics from tracked answers (TrackAnswer): mention and
 * citation rates with a 95% range, per AI tool and per week, and per prompt.
 */
import prisma from "../db.server";
import { getAiTool } from "../lib/aiTools";
import { rate } from "../lib/citationReport";

const DAY_MS = 86_400_000;
const addDays = (date, days) => new Date(date.getTime() + days * DAY_MS);

const named = (answer) => answer.cited || answer.mentioned;

async function answersSince(shop, since, select = {}) {
  return prisma.trackAnswer.findMany({
    where: { shop, createdAt: { gte: since }, error: null },
    select: {
      promptId: true,
      provider: true,
      cited: true,
      mentioned: true,
      createdAt: true,
      ...select,
    },
  });
}

/**
 * Headline numbers for a window, compared with the window before it.
 * @returns mention/citation rates, per-tool rates and an 8-week trend
 */
export async function getVisibilityStats(shop, { days = 28, weeks = 8 } = {}) {
  const now = new Date();
  const trendStart = addDays(now, -7 * weeks);
  const windowStart = addDays(now, -days);
  const previousStart = addDays(now, -2 * days);
  const earliest = new Date(
    Math.min(trendStart.getTime(), previousStart.getTime()),
  );
  const answers = await answersSince(shop, earliest);

  const current = answers.filter((answer) => answer.createdAt >= windowStart);
  const previous = answers.filter(
    (answer) =>
      answer.createdAt >= previousStart && answer.createdAt < windowStart,
  );

  const mention = rate(current.filter(named).length, current.length);
  const citation = rate(
    current.filter((answer) => answer.cited).length,
    current.length,
  );
  const previousMention = rate(previous.filter(named).length, previous.length);
  const previousCitation = rate(
    previous.filter((answer) => answer.cited).length,
    previous.length,
  );

  const providers = [...new Set(current.map((answer) => answer.provider))];
  const byTool = providers
    .map((id) => {
      const rows = current.filter((answer) => answer.provider === id);
      return {
        id,
        name: getAiTool(id)?.name ?? id,
        mention: rate(rows.filter(named).length, rows.length),
        citation: rate(rows.filter((answer) => answer.cited).length, rows.length),
      };
    })
    .sort((a, b) => (b.mention.value ?? 0) - (a.mention.value ?? 0));

  const trend = Array.from({ length: weeks }, (_, index) => {
    const start = addDays(now, -7 * (weeks - index));
    const end = addDays(start, 7);
    const rows = answers.filter(
      (answer) => answer.createdAt >= start && answer.createdAt < end,
    );
    return {
      start,
      mention: rate(rows.filter(named).length, rows.length),
      citation: rate(rows.filter((answer) => answer.cited).length, rows.length),
    };
  });

  const delta = (a, b) =>
    a.value != null && b.value != null ? a.value - b.value : null;

  return {
    days,
    answers: current.length,
    prompts: new Set(current.map((answer) => answer.promptId)).size,
    mention,
    citation,
    mentionDelta: delta(mention, previousMention),
    citationDelta: delta(citation, previousCitation),
    byTool,
    trend,
  };
}

/** Per-prompt mention and citation rates. */
export async function getPromptStats(shop, { days = 28 } = {}) {
  const since = addDays(new Date(), -days);
  const [prompts, answers] = await Promise.all([
    prisma.trackPrompt.findMany({
      where: { shop },
      orderBy: [{ selected: "desc" }, { createdAt: "asc" }],
    }),
    answersSince(shop, since),
  ]);
  return prompts.map((prompt) => {
    const rows = answers.filter((answer) => answer.promptId === prompt.id);
    const providers = [...new Set(rows.map((answer) => answer.provider))];
    return {
      id: prompt.id,
      text: prompt.text,
      kind: prompt.kind,
      selected: prompt.selected,
      answers: rows.length,
      mention: rate(rows.filter(named).length, rows.length),
      citation: rate(rows.filter((answer) => answer.cited).length, rows.length),
      byTool: providers.map((id) => {
        const toolRows = rows.filter((answer) => answer.provider === id);
        return {
          id,
          name: getAiTool(id)?.name ?? id,
          mention: rate(toolRows.filter(named).length, toolRows.length),
        };
      }),
    };
  });
}

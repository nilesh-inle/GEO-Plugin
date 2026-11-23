/**
 * GEO/AEO score for a blog post or page: a checklist of what can be verified
 * in its HTML, 0-100. It doesn't predict rankings. Pure functions.
 */
import { stripHtml } from "./policies";

export const CONTENT_PARTS = [
  { key: "answer", label: "Answer readiness", weight: 0.3 },
  { key: "credibility", label: "Credibility", weight: 0.25 },
  { key: "coverage", label: "Questions covered", weight: 0.2 },
  { key: "structure", label: "Structure", weight: 0.15 },
  { key: "freshness", label: "Freshness", weight: 0.1 },
];

const DAY_MS = 86_400_000;

const words = (text) => String(text || "").split(/\s+/).filter(Boolean);

function blocks(html, tag) {
  return [...String(html || "").matchAll(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "gi"))].map(
    (match) => stripHtml(match[1]),
  );
}

/** Splits the post into what the checks read. */
export function readContent(html) {
  const text = stripHtml(html);
  const headings = [...blocks(html, "h2"), ...blocks(html, "h3")].filter(Boolean);
  const paragraphs = blocks(html, "p").filter((item) => words(item).length > 0);
  const links = [...String(html || "").matchAll(/<a\s[^>]*href=["']([^"']+)["']/gi)].map((match) => match[1]);
  return {
    text,
    words: words(text).length,
    headings,
    questionHeadings: headings.filter((heading) => heading.trim().endsWith("?")),
    paragraphs,
    firstParagraph: paragraphs[0] ?? text.split(/(?<=[.!?])\s+/).slice(0, 3).join(" "),
    lists: (String(html || "").match(/<(ul|ol)[\s>]/gi) || []).length,
    tables: (String(html || "").match(/<table[\s>]/gi) || []).length,
    externalLinks: links.filter((href) => /^https?:\/\//i.test(href)).length,
    numbers: (text.match(/\b\d+(?:[.,]\d+)?\s?(?:%|percent|mm|cm|kg|g|lb|oz|ml|l|hours?|days?|years?)\b/gi) || []).length,
    faq: /\bFAQ\b|frequently asked/i.test(text),
  };
}

const clamp = (value) => Math.max(0, Math.min(100, Math.round(value)));

/**
 * @param {{ html: string, title: string, author?: string|null, updatedAt?: string|Date|null, now?: Date }} input
 * @returns {{ score: number, parts: Array<{key,label,weight,score}>, findings: Array<{part,text,passed}> }}
 */
export function scoreContent({ html, title, author, updatedAt, now = new Date() }) {
  const page = readContent(html);
  const findings = [];
  const note = (part, passed, text) => findings.push({ part, passed, text });

  // Answer readiness: a short direct opening, question headings, lists or tables.
  const opening = words(page.firstParagraph).length;
  const directOpening = opening >= 15 && opening <= 70;
  note("answer", directOpening, directOpening
    ? `Opens with a ${opening}-word answer`
    : opening < 15
      ? "No short opening paragraph that answers the title"
      : `The opening paragraph is ${opening} words; aim for 40–60`);
  note("answer", page.questionHeadings.length >= 2, `${page.questionHeadings.length} headings phrased as questions`);
  note("answer", page.lists + page.tables > 0, page.tables ? "Has a comparison table" : page.lists ? "Has lists" : "No lists or tables");
  const answer = clamp((directOpening ? 50 : opening >= 15 ? 25 : 0) + Math.min(2, page.questionHeadings.length) * 15 + (page.lists + page.tables > 0 ? 20 : 0));

  // Credibility: author, sources, numbers, recent date.
  const ageDays = updatedAt ? (now.getTime() - new Date(updatedAt).getTime()) / DAY_MS : null;
  note("credibility", Boolean(author), author ? `Author: ${author}` : "No author named");
  note("credibility", page.externalLinks >= 2, `${page.externalLinks} links to sources`);
  note("credibility", page.numbers >= 2, `${page.numbers} figures with units or percentages`);
  const credibility = clamp((author ? 30 : 0) + Math.min(3, page.externalLinks) * 13 + Math.min(3, page.numbers) * 10);

  // Questions covered: question headings and an FAQ section.
  note("coverage", page.faq, page.faq ? "Has an FAQ section" : "No FAQ section");
  const coverage = clamp(Math.min(5, page.questionHeadings.length) * 14 + (page.faq ? 30 : 0));

  // Structure: enough length, headings, short paragraphs.
  const avgParagraph = page.paragraphs.length
    ? page.paragraphs.reduce((sum, item) => sum + words(item).length, 0) / page.paragraphs.length
    : page.words;
  note("structure", page.words >= 300, `${page.words} words`);
  note("structure", page.headings.length >= 3, `${page.headings.length} section headings`);
  note("structure", avgParagraph <= 90, `Paragraphs average ${Math.round(avgParagraph)} words`);
  const structure = clamp((page.words >= 300 ? 35 : (page.words / 300) * 35) + Math.min(3, page.headings.length) * 15 + (avgParagraph <= 90 ? 20 : 0));

  // Freshness.
  const freshness = ageDays == null ? 50 : ageDays <= 365 ? 100 : ageDays <= 730 ? 50 : 0;
  note("freshness", freshness === 100, ageDays == null ? "Update date unknown" : `Updated ${Math.round(ageDays)} days ago`);

  const values = { answer, credibility, coverage, structure, freshness };
  const parts = CONTENT_PARTS.map((part) => ({ ...part, score: values[part.key] }));
  const score = clamp(parts.reduce((sum, part) => sum + part.score * part.weight, 0));
  return { score, parts, findings, words: page.words, title };
}

export const CONTENT_SUGGESTIONS_SCHEMA = {
  type: "object",
  properties: {
    opening: { type: "string" },
    questionHeadings: {
      type: "array",
      items: {
        type: "object",
        properties: { from: { type: "string" }, to: { type: "string" } },
        required: ["from", "to"],
        additionalProperties: false,
      },
    },
    faqs: {
      type: "array",
      items: {
        type: "object",
        properties: { question: { type: "string" }, answer: { type: "string" } },
        required: ["question", "answer"],
        additionalProperties: false,
      },
    },
  },
  required: ["opening", "questionHeadings", "faqs"],
  additionalProperties: false,
};

/** Request for answer-first improvements, using only what the page already says. */
export function buildContentRequest({ title, html, storeName }) {
  const page = readContent(html);
  return {
    system: `You help a store make one of its articles easy for AI assistants to quote.
Use only facts stated in the article. Never invent numbers, sources, people or claims.
- opening: 40 to 60 words that directly answer the article's title, plain text.
- questionHeadings: up to 4 existing headings rewritten as the question a shopper would ask ("from" exactly as given).
- faqs: up to 5 questions this article already answers, each answer under 50 words.`,
    prompt: `Store: ${storeName ?? ""}
Title: ${title}
Headings: ${page.headings.slice(0, 15).join(" | ") || "(none)"}
Article text:
${page.text.slice(0, 6000)}`,
    schema: CONTENT_SUGGESTIONS_SCHEMA,
  };
}

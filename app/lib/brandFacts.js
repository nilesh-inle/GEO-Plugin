/**
 * Brand facts: canonical statements about the store, and the request that
 * checks them against tracked AI answers. Pure functions.
 */
import { countryName } from "./prompts";

export const FACT_GROUPS = {
  company: "Company",
  policies: "Policies",
  products: "Products",
  contact: "Contact",
};

export const MAX_FACTS = 30;

/** Validates a fact typed by the merchant. Returns { fact } or { error }. */
export function cleanFact(input) {
  const group = Object.hasOwn(FACT_GROUPS, input?.group) ? input.group : "company";
  const label = String(input?.label ?? "").trim().replace(/\s+/g, " ").slice(0, 60);
  const value = String(input?.value ?? "").trim().replace(/\s+/g, " ").slice(0, 300);
  if (label.length < 2) return { error: "Name the fact, for example “Return window”." };
  if (!value) return { error: "Enter the fact's value." };
  return { fact: { group, label, value } };
}

/** Facts GEO can read from Shopify, offered when the list is empty. */
export function suggestedFacts(store) {
  const facts = store?.shopFacts ?? {};
  return [
    store?.name && { group: "company", label: "Store name", value: store.name },
    store?.url && { group: "company", label: "Website", value: store.url },
    store?.country && {
      group: "company",
      label: "Based in",
      value: countryName(store.country) ?? store.country,
    },
    facts.refundWindowDays && {
      group: "policies",
      label: "Return window",
      value: `${facts.refundWindowDays} days`,
    },
    facts.shipsTo?.length && {
      group: "policies",
      label: "Ships to",
      value:
        facts.shipsTo.length <= 6
          ? facts.shipsTo.map((code) => countryName(code) ?? code).join(", ")
          : `${facts.shipsTo.length} countries`,
    },
    store?.currency && { group: "policies", label: "Prices in", value: store.currency },
    store?.contactEmail && {
      group: "contact",
      label: "Customer service email",
      value: store.contactEmail,
    },
  ].filter(Boolean);
}

export const FACT_CHECK_SCHEMA = {
  type: "object",
  properties: {
    facts: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          status: {
            type: "string",
            enum: ["consistent", "contradicted", "not_mentioned"],
          },
          said: { type: "string" },
          answers: { type: "integer" },
        },
        required: ["id", "status", "said", "answers"],
        additionalProperties: false,
      },
    },
  },
  required: ["facts"],
  additionalProperties: false,
};

const SYSTEM = `You check whether AI assistant answers state a store's facts correctly.
For each fact, read the answers and decide:
- "consistent": an answer states the fact and agrees with the store's value.
- "contradicted": an answer states a different value for the same fact. Put the conflicting wording in "said" (under 120 characters).
- "not_mentioned": no answer states this fact.
"answers" is how many answers state the fact (agreeing or not). Judge meaning, not wording: "30-day returns" agrees with "30 days". Return every fact id exactly once.`;

/**
 * @param {{ store: object, facts: Array<{id,label,value}>, answers: Array<{text: string}> }} input
 */
export function buildFactCheckRequest({ store, facts, answers }) {
  const factLines = facts.map((fact) => `- id ${fact.id}: ${fact.label} = ${fact.value}`);
  const answerBlocks = answers.map(
    (answer, index) => `Answer ${index + 1}:\n${String(answer.text).slice(0, 1500)}`,
  );
  return {
    system: SYSTEM,
    prompt: `Store: ${store.name}

Facts:
${factLines.join("\n")}

${answerBlocks.join("\n\n")}`,
    schema: FACT_CHECK_SCHEMA,
  };
}

/** Keeps only results for known fact ids with a valid status. */
export function normalizeFactCheck(result, facts) {
  const ids = new Set(facts.map((fact) => fact.id));
  const statuses = new Set(["consistent", "contradicted", "not_mentioned"]);
  const out = {};
  for (const item of result?.facts ?? []) {
    if (!ids.has(item?.id) || !statuses.has(item?.status) || out[item.id]) continue;
    out[item.id] = {
      status: item.status,
      said: String(item.said ?? "").slice(0, 160),
      answers: Math.max(0, Number.parseInt(item.answers, 10) || 0),
    };
  }
  return out;
}

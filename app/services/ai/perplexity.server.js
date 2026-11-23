/**
 * Perplexity through the Agent API (/v1/agent). Sonar Chat Completions was
 * retired on 2026-09-27; Agent API "effort" presets replace the Sonar models
 * (sonar and sonar-pro map to "fast", sonar-reasoning-pro to "low").
 */
import {
  ASK_TIMEOUT_MS,
  parseJsonLoose,
  requestJson,
  uniqueSources,
} from "./http.server";

const AGENT_URL = "https://api.perplexity.ai/v1/agent";

// Perplexity has no models endpoint; these are its search presets.
const MODELS = [
  { value: "fast", label: "Fast search (was Sonar and Sonar Pro)" },
  { value: "low", label: "Pro search (was Sonar Reasoning Pro)" },
  { value: "medium", label: "Deeper search" },
];

const headers = (apiKey) => ({ Authorization: `Bearer ${apiKey}` });

function run(apiKey, body, timeoutMs = ASK_TIMEOUT_MS) {
  return requestJson(AGENT_URL, {
    method: "POST",
    headers: headers(apiKey),
    timeoutMs,
    body,
  });
}

export async function listModels() {
  return { models: MODELS, recommended: MODELS[0].value };
}

/** Perplexity can only validate a key by answering, so this is one tiny request. */
export async function verifyModel(apiKey, model) {
  await run(
    apiKey,
    { effort: model, input: "Reply with the word OK.", max_output_tokens: 16 },
    60_000,
  );
}

/** Answer text and its numbered sources (search results) and inline citations. */
export function parseResponse(data) {
  const output = data?.output ?? [];
  const parts = output
    .filter((item) => item.type === "message")
    .flatMap((item) => item.content ?? [])
    .filter((part) => part.type === "output_text");
  const citations = parts
    .flatMap((part) => part.annotations ?? [])
    .filter((annotation) => annotation.type === "url_citation");
  const results = output
    .filter((item) => item.type === "search_results")
    .flatMap((item) => item.results ?? []);

  return {
    text: parts
      .map((part) => part.text)
      .join("\n")
      .trim(),
    sources: uniqueSources([...citations, ...results]),
  };
}

export async function ask(apiKey, model, prompt) {
  return parseResponse(await run(apiKey, { effort: model, input: prompt }));
}

export async function generateJson(apiKey, model, { system, prompt }) {
  const data = await run(apiKey, {
    effort: model,
    instructions: system,
    input: prompt,
  });
  return parseJsonLoose(parseResponse(data).text);
}

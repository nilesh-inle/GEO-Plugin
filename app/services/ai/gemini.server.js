/**
 * Gemini through the Gemini API with Grounding with Google Search.
 */
import {
  ASK_TIMEOUT_MS,
  AiToolError,
  parseJsonLoose,
  requestJson,
  uniqueSources,
} from "./http.server";

const BASE_URL = "https://generativelanguage.googleapis.com/v1beta";

const headers = (apiKey) => ({ "x-goog-api-key": apiKey });

// Text models only; image, audio, embedding and live models can't answer prompts here.
const EXCLUDED =
  /embedding|image|tts|audio|live|vision|robotics|computer-use|native|aqa|learnlm|gemma|veo|imagen/;

function version(id) {
  const match = /gemini-(\d+(?:\.\d+)?)/.exec(id);
  return match ? Number(match[1]) : 0;
}

export async function listModels(apiKey) {
  const data = await requestJson(`${BASE_URL}/models?pageSize=1000`, {
    headers: headers(apiKey),
  });
  const models = (data?.models ?? [])
    .map((model) => ({
      value: String(model.name).replace(/^models\//, ""),
      label: model.displayName || model.name,
      methods: model.supportedGenerationMethods ?? [],
    }))
    .filter(
      (model) =>
        model.value.startsWith("gemini") &&
        model.methods.includes("generateContent") &&
        !EXCLUDED.test(model.value),
    )
    .sort((a, b) => version(b.value) - version(a.value))
    .map(({ value, label }) => ({ value, label }));

  const recommended =
    models.find((model) => !/lite|preview|exp/.test(model.value)) ?? models[0];
  return { models, recommended: recommended?.value ?? null };
}

export async function verifyModel(apiKey, model) {
  await requestJson(`${BASE_URL}/models/${encodeURIComponent(model)}`, {
    headers: headers(apiKey),
  });
}

/**
 * Answer text and grounding sources. Source URIs are Google redirect links;
 * the title holds the source's domain, which is what citation matching uses.
 */
export function parseResponse(data) {
  if (data?.promptFeedback?.blockReason)
    throw new AiToolError("Gemini declined to answer this prompt.", {
      kind: "refused",
    });
  const candidate = data?.candidates?.[0];
  return {
    text: (candidate?.content?.parts ?? [])
      .map((part) => part.text ?? "")
      .join("")
      .trim(),
    sources: uniqueSources(
      (candidate?.groundingMetadata?.groundingChunks ?? [])
        .map((chunk) => chunk.web)
        .filter(Boolean)
        .map((web) => ({ url: web.uri, title: web.title })),
    ),
  };
}

function generate(apiKey, model, body) {
  return requestJson(
    `${BASE_URL}/models/${encodeURIComponent(model)}:generateContent`,
    {
      method: "POST",
      headers: headers(apiKey),
      timeoutMs: ASK_TIMEOUT_MS,
      body,
    },
  );
}

export async function ask(apiKey, model, prompt) {
  const data = await generate(apiKey, model, {
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    tools: [{ google_search: {} }],
  });
  return parseResponse(data);
}

export async function generateJson(apiKey, model, { system, prompt }) {
  const data = await generate(apiKey, model, {
    systemInstruction: { parts: [{ text: system }] },
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: { responseMimeType: "application/json" },
  });
  return parseJsonLoose(parseResponse(data).text);
}

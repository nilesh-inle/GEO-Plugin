/**
 * ChatGPT through the OpenAI Responses API with the web_search tool.
 */
import {
  ASK_TIMEOUT_MS,
  AiToolError,
  parseJsonLoose,
  requestJson,
  uniqueSources,
} from "./http.server";

const BASE_URL = "https://api.openai.com/v1";

const headers = (apiKey) => ({ Authorization: `Bearer ${apiKey}` });

// Chat models that can use web search. Excludes audio, image, embedding and
// other special-purpose models, and dated snapshots of listed models.
const CHAT_MODEL = /^(gpt-(4o|4\.1|[5-9])|o[3-9])/;
const EXCLUDED =
  /audio|realtime|tts|transcribe|image|search|embedding|moderation|instruct|nano|codex|oss|computer-use|deep-research|chat-latest/;
const DATED = /-\d{4}-\d{2}-\d{2}$/;

export async function listModels(apiKey) {
  const data = await requestJson(`${BASE_URL}/models`, {
    headers: headers(apiKey),
  });
  const models = (data?.data ?? [])
    .filter(
      (model) =>
        CHAT_MODEL.test(model.id) &&
        !EXCLUDED.test(model.id) &&
        !DATED.test(model.id),
    )
    .sort((a, b) => (b.created ?? 0) - (a.created ?? 0))
    .map((model) => ({ value: model.id, label: model.id }));

  const recommended =
    models.find((model) => !/mini/.test(model.value)) ?? models[0];
  return { models, recommended: recommended?.value ?? null };
}

export async function verifyModel(apiKey, model) {
  await requestJson(`${BASE_URL}/models/${encodeURIComponent(model)}`, {
    headers: headers(apiKey),
  });
}

/** Text and cited links from a Responses API result. */
export function parseResponse(data) {
  const parts = (data?.output ?? [])
    .filter((item) => item.type === "message")
    .flatMap((item) => item.content ?? [])
    .filter((part) => part.type === "output_text");

  return {
    text: parts
      .map((part) => part.text)
      .join("\n")
      .trim(),
    sources: uniqueSources(
      parts
        .flatMap((part) => part.annotations ?? [])
        .filter((annotation) => annotation.type === "url_citation"),
    ),
  };
}

export async function ask(apiKey, model, prompt, { country } = {}) {
  const data = await requestJson(`${BASE_URL}/responses`, {
    method: "POST",
    headers: headers(apiKey),
    timeoutMs: ASK_TIMEOUT_MS,
    body: {
      model,
      input: prompt,
      tools: [
        {
          type: "web_search",
          ...(country && {
            user_location: { type: "approximate", country },
          }),
        },
      ],
      store: false,
    },
  });
  if (data?.error)
    throw new AiToolError(data.error.message ?? "Request failed");
  return parseResponse(data);
}

export async function generateJson(apiKey, model, { system, prompt, schema }) {
  const data = await requestJson(`${BASE_URL}/responses`, {
    method: "POST",
    headers: headers(apiKey),
    timeoutMs: ASK_TIMEOUT_MS,
    body: {
      model,
      instructions: system,
      input: prompt,
      text: {
        format: { type: "json_schema", name: "result", schema, strict: true },
      },
      store: false,
    },
  });
  return parseJsonLoose(parseResponse(data).text);
}

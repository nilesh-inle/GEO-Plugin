/**
 * Claude through the Anthropic Messages API with the web search server tool.
 */
import Anthropic from "@anthropic-ai/sdk";
import {
  ASK_TIMEOUT_MS,
  AiToolError,
  parseJsonLoose,
  toAiToolError,
  uniqueSources,
} from "./http.server";

const RECOMMENDED_MODEL = "claude-opus-5-5";
const MAX_TOKENS = 16000;
const MAX_CONTINUATIONS = 3;

// Models that accept server-side refusal fallbacks. On a policy decline the
// API re-runs the request on a fallback model inside the same call.
const FALLBACK_MODELS = new Set([
  "claude-fable-5-2",
  "claude-fable-5-1",
  "claude-opus-5-5",
  "claude-opus-5",
  "claude-sonnet-5-5",
]);
const FALLBACK_BETA = "server-side-fallback-2026-07-01";

// Only the merchant's key is used: no credentials or base URL from the
// server's environment (ANTHROPIC_AUTH_TOKEN, ANTHROPIC_BASE_URL).
const client = (apiKey) =>
  new Anthropic({
    apiKey,
    authToken: null,
    baseURL: "https://api.anthropic.com",
    maxRetries: 2,
    timeout: ASK_TIMEOUT_MS,
  });

/**
 * Web search tool version. The dynamic-filtering variant needs Fable/Mythos,
 * or Opus/Sonnet 4.6 and later; other models use the basic variant.
 */
export function webSearchToolType(model) {
  const match =
    /claude-(opus|sonnet|haiku|fable|mythos)-(\d+)(?:-(\d{1,2})(?!\d))?/.exec(
      model,
    );
  if (!match) return "web_search_20250305";
  const [, family, major, minor = "0"] = match;
  if (family === "fable" || family === "mythos") return "web_search_20260209";
  if (family === "haiku") return "web_search_20250305";
  const version = Number(major) + Number(minor) / 10;
  return version >= 4.6 ? "web_search_20260209" : "web_search_20250305";
}

function apiErrorMessage(error) {
  return error.error?.error?.message ?? error.message;
}

/** Maps SDK errors to AiToolError so the UI can explain them. */
function toToolError(error) {
  if (error instanceof AiToolError) return error;
  if (error instanceof Anthropic.APIConnectionTimeoutError)
    return new AiToolError("Claude took too long to answer.", {
      kind: "network",
    });
  if (error instanceof Anthropic.APIConnectionError)
    return new AiToolError(`Couldn't reach Claude: ${error.message}`, {
      kind: "network",
    });
  if (error instanceof Anthropic.AuthenticationError)
    return toAiToolError(401, apiErrorMessage(error));
  if (error instanceof Anthropic.PermissionDeniedError)
    return toAiToolError(403, apiErrorMessage(error));
  if (error instanceof Anthropic.NotFoundError)
    return toAiToolError(404, apiErrorMessage(error));
  if (error instanceof Anthropic.RateLimitError)
    return toAiToolError(429, apiErrorMessage(error));
  if (error instanceof Anthropic.BadRequestError)
    return toAiToolError(400, apiErrorMessage(error));
  if (error instanceof Anthropic.APIError)
    return toAiToolError(error.status ?? 500, apiErrorMessage(error));
  return error;
}

async function createMessage(anthropic, params) {
  try {
    if (FALLBACK_MODELS.has(params.model)) {
      return await anthropic.beta.messages.create({
        ...params,
        betas: [FALLBACK_BETA],
        fallbacks: "default",
      });
    }
    return await anthropic.messages.create(params);
  } catch (error) {
    throw toToolError(error);
  }
}

function assertAnswered(message) {
  if (message.stop_reason === "refusal")
    throw new AiToolError("Claude declined to answer this prompt.", {
      kind: "refused",
    });
}

export async function listModels(apiKey) {
  const models = [];
  try {
    for await (const model of client(apiKey).models.list({ limit: 100 })) {
      models.push({ value: model.id, label: model.display_name || model.id });
    }
  } catch (error) {
    throw toToolError(error);
  }
  const recommended =
    models.find((model) => model.value === RECOMMENDED_MODEL) ?? models[0];
  return { models, recommended: recommended?.value ?? null };
}

export async function verifyModel(apiKey, model) {
  try {
    await client(apiKey).models.retrieve(model);
  } catch (error) {
    throw toToolError(error);
  }
}

/** Answer text and the links Claude cited from its web search results. */
export function parseMessage(message) {
  const textBlocks = (message?.content ?? []).filter(
    (block) => block.type === "text",
  );
  return {
    text: textBlocks
      .map((block) => block.text)
      .join("")
      .trim(),
    sources: uniqueSources(
      textBlocks
        .flatMap((block) => block.citations ?? [])
        .filter((citation) => citation.type === "web_search_result_location"),
    ),
  };
}

export async function ask(apiKey, model, prompt, { country } = {}) {
  const anthropic = client(apiKey);
  const tools = [
    {
      type: webSearchToolType(model),
      name: "web_search",
      max_uses: 5,
      ...(country && { user_location: { type: "approximate", country } }),
    },
  ];
  const messages = [{ role: "user", content: prompt }];
  let message;

  // A long server-tool turn can pause; send it back so the server continues it.
  for (let turn = 0; turn <= MAX_CONTINUATIONS; turn++) {
    message = await createMessage(anthropic, {
      model,
      max_tokens: MAX_TOKENS,
      tools,
      messages,
    });
    if (message.stop_reason !== "pause_turn") break;
    messages.push({ role: "assistant", content: message.content });
  }

  assertAnswered(message);
  return parseMessage(message);
}

export async function generateJson(apiKey, model, { system, prompt, schema }) {
  const message = await createMessage(client(apiKey), {
    model,
    max_tokens: MAX_TOKENS,
    system,
    messages: [{ role: "user", content: prompt }],
    output_config: { format: { type: "json_schema", schema } },
  });
  assertAnswered(message);
  return parseJsonLoose(parseMessage(message).text);
}

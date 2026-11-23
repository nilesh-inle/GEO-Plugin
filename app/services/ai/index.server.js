/**
 * AI tool adapters. Each one exposes the same four calls:
 *
 *   listModels(apiKey)              -> { models: [{ value, label }], recommended }
 *   verifyModel(apiKey, model)      -> resolves when the key can use the model
 *   ask(apiKey, model, prompt, opt) -> { text, sources: [{ url, title }] } (with web search)
 *   generateJson(apiKey, model, { system, prompt, schema }) -> parsed object
 *
 * All of them throw AiToolError for provider errors. An optional
 * `concurrency` export sets the requests in flight during a run.
 * getAdapter() logs every call to the terminal, never with the full key.
 */
import { getAiTool } from "../../lib/aiTools";
import * as anthropic from "./anthropic.server";
import * as cursor from "./cursor.server";
import * as gemini from "./gemini.server";
import * as openai from "./openai.server";
import * as perplexity from "./perplexity.server";

export { AiToolError } from "./http.server";

const ADAPTERS = { openai, perplexity, gemini, anthropic, cursor };
const CALLS = ["listModels", "verifyModel", "ask", "generateJson"];
const PREVIEW_CHARS = 80;

/** The key's last 4 characters, as the AI tools page shows it. */
export function maskKey(apiKey) {
  const key = String(apiKey ?? "").trim();
  return key ? `…${key.slice(-4)}` : "none";
}

const preview = (text) => {
  const value = String(text ?? "")
    .replace(/\s+/g, " ")
    .trim();
  return value.length > PREVIEW_CHARS
    ? `${value.slice(0, PREVIEW_CHARS - 1)}…`
    : value;
};

const seconds = (since) => `${((Date.now() - since) / 1000).toFixed(1)}s`;

function describeCall(call, apiKey, [model, input]) {
  const parts = [`key ${maskKey(apiKey)}`];
  if (call !== "listModels") parts.unshift(`model ${model}`);
  if (call === "ask") parts.push(`prompt "${preview(input)}"`);
  if (call === "generateJson") parts.push("writing prompts");
  return parts.join(" · ");
}

function describeResult(call, result) {
  if (call === "listModels") return `${result?.models?.length ?? 0} models`;
  if (call === "ask")
    return `${result?.text?.length ?? 0} chars · sources: ${result?.sources?.length ?? 0}`;
  if (call === "verifyModel") return "key and model OK";
  return "reply received";
}

/** Wraps an adapter so each call logs when it's sent and how it ended. */
export function withLogs(provider, adapter, log = console) {
  const name = getAiTool(provider)?.name ?? provider;
  const logged = { ...adapter };
  for (const call of CALLS) {
    if (typeof adapter[call] !== "function") continue;
    logged[call] = async (apiKey, ...args) => {
      const started = Date.now();
      log.info(
        `[geo:ai] → ${name} ${call} · ${describeCall(call, apiKey, args)}`,
      );
      try {
        const result = await adapter[call](apiKey, ...args);
        log.info(
          `[geo:ai] ✓ ${name} ${call} in ${seconds(started)} · ${describeResult(call, result)}`,
        );
        return result;
      } catch (error) {
        log.warn(
          `[geo:ai] ✗ ${name} ${call} failed in ${seconds(started)} · ${error.message}`,
        );
        throw error;
      }
    };
  }
  return Object.freeze(logged);
}

const LOGGED = Object.fromEntries(
  Object.entries(ADAPTERS).map(([provider, adapter]) => [
    provider,
    withLogs(provider, adapter),
  ]),
);

export function getAdapter(provider) {
  const adapter = LOGGED[provider];
  if (!adapter) throw new Error(`Unknown AI tool: ${provider}`);
  return adapter;
}

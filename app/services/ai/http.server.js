/**
 * Shared HTTP and error handling for the AI tool adapters.
 */

export const ASK_TIMEOUT_MS = 180_000;
const DEFAULT_TIMEOUT_MS = 30_000;
const QUOTA_PATTERN = /quota|billing|credit|balance|payment|insufficient/i;

/**
 * An AI provider error the UI can explain. `kind` is one of
 * auth | billing | account | model | rate | refused | request | network | other.
 * `account` is an account setting the merchant has to change at the provider.
 */
export class AiToolError extends Error {
  constructor(message, { kind = "other", status } = {}) {
    super(message);
    this.name = "AiToolError";
    this.kind = kind;
    this.status = status;
  }

  /** The key or account can't be used again until the merchant fixes it. */
  get blocksTool() {
    return ["auth", "billing", "account"].includes(this.kind);
  }
}

const KIND_BY_STATUS = {
  400: "request",
  401: "auth",
  402: "billing",
  403: "auth",
  404: "model",
  429: "rate",
};

const PREFIX_BY_KIND = {
  auth: "The API key was rejected",
  billing: "The account has no credit or quota left",
  model: "This model isn't available for this key",
  rate: "Too many requests right now. Try again later",
};

/** Builds an AiToolError from an HTTP status and the provider's message. */
export function toAiToolError(status, providerMessage) {
  let kind = KIND_BY_STATUS[status] ?? (status >= 500 ? "other" : "request");
  if ((status === 400 || status === 429) && QUOTA_PATTERN.test(providerMessage))
    kind = "billing";
  const detail = String(providerMessage || `HTTP ${status}`).slice(0, 300);
  const prefix = PREFIX_BY_KIND[kind];
  return new AiToolError(prefix ? `${prefix}: ${detail}` : detail, {
    kind,
    status,
  });
}

function errorMessage(data) {
  if (!data) return null;
  if (typeof data.error === "string") return data.error;
  return data.error?.message ?? data.message ?? data.detail ?? null;
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Host and path only, for logs. */
function endpoint(url) {
  try {
    const { host, pathname } = new URL(url);
    return `${host}${pathname}`;
  } catch {
    return "the AI tool";
  }
}

function logRetry(url, delay, reason) {
  console.warn(
    `[geo:ai] ↻ retrying ${endpoint(url)} in ${(delay / 1000).toFixed(1)}s (${reason})`,
  );
}

function retryDelay(response, attempt) {
  const seconds = Number(response?.headers.get("retry-after"));
  if (Number.isFinite(seconds) && seconds > 0)
    return Math.min(seconds, 60) * 1000;
  return 1000 * 2 ** attempt + Math.random() * 500;
}

/**
 * JSON request with retries on rate limits, 5xx and network errors.
 * Throws AiToolError for everything else.
 */
export async function requestJson(
  url,
  {
    method = "GET",
    headers,
    body,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    retries = 2,
  } = {},
) {
  for (let attempt = 0; ; attempt++) {
    let response;
    try {
      response = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json", ...headers },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      if (attempt < retries) {
        const delay = retryDelay(null, attempt);
        logRetry(
          url,
          delay,
          error.name === "TimeoutError" ? "timed out" : "network error",
        );
        await wait(delay);
        continue;
      }
      throw new AiToolError(
        error.name === "TimeoutError"
          ? "The AI tool took too long to answer."
          : `Couldn't reach the AI tool: ${error.message}`,
        { kind: "network" },
      );
    }

    const data = await response.json().catch(() => null);
    if (response.ok) return data;

    const message = errorMessage(data) || `HTTP ${response.status}`;
    const retryable =
      response.status >= 500 ||
      (response.status === 429 && !QUOTA_PATTERN.test(message));
    if (retryable && attempt < retries) {
      const delay = retryDelay(response, attempt);
      logRetry(url, delay, `HTTP ${response.status}`);
      await wait(delay);
      continue;
    }
    throw toAiToolError(response.status, message);
  }
}

/** Parses JSON from model output, tolerating code fences and surrounding text. */
export function parseJsonLoose(text) {
  const source = String(text ?? "").trim();
  try {
    return JSON.parse(source);
  } catch {
    const start = source.indexOf("{");
    const end = source.lastIndexOf("}");
    if (start === -1 || end <= start)
      throw new AiToolError("The AI tool didn't return JSON.", {
        kind: "request",
      });
    try {
      return JSON.parse(source.slice(start, end + 1));
    } catch {
      throw new AiToolError(
        "The AI tool returned JSON that couldn't be read.",
        {
          kind: "request",
        },
      );
    }
  }
}

/** De-duplicates sources by URL and caps the list. */
export function uniqueSources(sources, limit = 20) {
  const seen = new Set();
  const result = [];
  for (const source of sources) {
    if (!source?.url || seen.has(source.url)) continue;
    seen.add(source.url);
    result.push({ url: source.url, title: source.title || "" });
    if (result.length >= limit) break;
  }
  return result;
}

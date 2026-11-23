/**
 * Cursor through its Cloud Agents API (public beta), which has no chat
 * endpoint. Each answer launches a cloud agent without a repository, waits
 * for its run to finish and reads the final reply, then archives the agent
 * so it doesn't fill the merchant's Cursor dashboard. Answers come without a
 * source list, so the links written in the answer are used as its sources.
 * Docs: https://cursor.com/docs/cloud-agent/api/endpoints
 */
import { countryName } from "../../lib/prompts";
import {
  AiToolError,
  parseJsonLoose,
  requestJson,
  uniqueSources,
} from "./http.server";

const API_URL = "https://api.cursor.com/v1";
const DEFAULT_MODEL = "default";
const ASK_TIMEOUT_MS = 6 * 60_000;
// Prompt writing runs inside a page request, so it must finish sooner.
const JSON_TIMEOUT_MS = 90_000;
const POLL_MS = [1000, 2000, 4000];
const ACTIVE = new Set(["CREATING", "RUNNING", "WAITING_FOR_BACKGROUND_WORK"]);

/** Agents take minutes, so a run asks more of them at once. */
export const concurrency = 4;

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function call(apiKey, path, options = {}) {
  try {
    return await requestJson(`${API_URL}${path}`, {
      ...options,
      // Basic auth: the key is the username, the password is empty.
      headers: {
        Authorization: `Basic ${Buffer.from(`${apiKey}:`).toString("base64")}`,
      },
    });
  } catch (error) {
    if (!(error instanceof AiToolError)) throw error;
    // Privacy Mode (Legacy) turns storage off, and cloud agents can't run
    // without it. Cursor answers "Storage mode is disabled…".
    if (/storage/i.test(error.message))
      throw new AiToolError(
        "Cursor's cloud agents need storage, and it's off for this Cursor account (Privacy Mode (Legacy)). Switch to Privacy Mode in Cursor's dashboard, or ask your Cursor team admin. GEO can't use Cursor until then.",
        { kind: "account", status: error.status },
      );
    if (error.status === 403 && /free plan|api access/i.test(error.message))
      throw new AiToolError(
        "Your Cursor plan doesn't include API access. The Cloud Agents API needs a paid plan.",
        { kind: "billing", status: 403 },
      );
    throw error;
  }
}

export async function listModels(apiKey) {
  const data = await call(apiKey, "/models");
  const models = (data?.items ?? [])
    .filter((item) => item?.id)
    .map((item) => ({ value: item.id, label: item.displayName || item.id }));
  return {
    models: [
      { value: DEFAULT_MODEL, label: "Cursor's default model" },
      ...models,
    ],
    recommended: DEFAULT_MODEL,
  };
}

/** Checks the key by listing models. Launching an agent would be billed. */
export async function verifyModel(apiKey, model) {
  const { models } = await listModels(apiKey);
  if (!models.some((item) => item.value === model))
    throw new AiToolError(`This model isn't available for this key: ${model}`, {
      kind: "model",
    });
}

const LINK_PATTERN =
  /\[([^\]\n]{1,200})\]\((https?:\/\/[^\s)]+)\)|(https?:\/\/[^\s<>()"'\]]+)/g;

/** Links written in an answer: markdown links and bare URLs. */
export function linksInText(text) {
  const links = [];
  for (const match of String(text ?? "").matchAll(LINK_PATTERN)) {
    const url = (match[2] ?? match[3]).replace(/[.,;:!?*_]+$/, "");
    links.push({ url, title: match[1] ?? "" });
  }
  return uniqueSources(links);
}

/** Launches an agent with `text`, waits for its reply and archives it. */
async function runAgent(apiKey, model, text, timeoutMs) {
  const created = await call(apiKey, "/agents", {
    method: "POST",
    body: {
      prompt: { text },
      ...(model && model !== DEFAULT_MODEL && { model: { id: model } }),
      autoCreatePR: false,
    },
  });
  const agentId = created?.agent?.id;
  const runId = created?.run?.id ?? created?.agent?.latestRunId;
  if (!agentId || !runId)
    throw new AiToolError("Cursor didn't start an agent.", { kind: "other" });

  const agentPath = `/agents/${encodeURIComponent(agentId)}`;
  try {
    const deadline = Date.now() + timeoutMs;
    let run = created.run ?? { status: "CREATING" };
    for (let poll = 0; ACTIVE.has(run?.status); poll++) {
      if (Date.now() > deadline)
        throw new AiToolError("The Cursor agent took too long to answer.", {
          kind: "network",
        });
      await wait(POLL_MS[Math.min(poll, POLL_MS.length - 1)]);
      run = await call(
        apiKey,
        `${agentPath}/runs/${encodeURIComponent(runId)}`,
      );
    }
    if (run?.status !== "FINISHED")
      throw new AiToolError(
        `The Cursor agent stopped without answering (${String(run?.status ?? "unknown").toLowerCase()}).`,
        { kind: "other" },
      );
    return String(run.result ?? "").trim();
  } finally {
    // Archiving is reversible; deleting isn't.
    await call(apiKey, `${agentPath}/archive`, {
      method: "POST",
      retries: 0,
    }).catch(() => {});
  }
}

function shopperQuestion(prompt, country) {
  const place = countryName(country);
  return [
    "Answer this shopping question the way a helpful AI assistant would. Search the web if you can, and link to the websites you recommend or used.",
    "Don't create, edit or run any files. Just reply with the answer.",
    place && `The shopper is in ${place}.`,
    "",
    `Question: ${prompt}`,
  ]
    .filter((line) => line !== null)
    .join("\n");
}

export async function ask(apiKey, model, prompt, { country } = {}) {
  const text = await runAgent(
    apiKey,
    model,
    shopperQuestion(prompt, country),
    ASK_TIMEOUT_MS,
  );
  return { text, sources: linksInText(text) };
}

export async function generateJson(apiKey, model, { system, prompt }) {
  const text = await runAgent(
    apiKey,
    model,
    `${system}\n\n${prompt}\n\nDon't create, edit or run any files. Reply with the JSON only.`,
    JSON_TIMEOUT_MS,
  );
  return parseJsonLoose(text);
}

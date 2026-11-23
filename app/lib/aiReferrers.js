/**
 * Recognises visits that came from an AI assistant, by referrer host or
 * utm_source. ChatGPT adds utm_source=chatgpt.com to the links it shows.
 * Visits without a referrer or UTM tag can't be attributed and aren't counted.
 */

export const AI_PLATFORMS = [
  {
    id: "chatgpt",
    name: "ChatGPT",
    hosts: ["chatgpt.com", "chat.openai.com"],
    utm: ["chatgpt.com", "chatgpt", "openai"],
  },
  {
    id: "perplexity",
    name: "Perplexity",
    hosts: ["perplexity.ai"],
    utm: ["perplexity", "perplexity.ai"],
  },
  {
    id: "gemini",
    name: "Gemini",
    hosts: ["gemini.google.com", "bard.google.com"],
    utm: ["gemini", "gemini.google.com"],
  },
  {
    id: "copilot",
    name: "Microsoft Copilot",
    hosts: ["copilot.microsoft.com", "copilot.cloud.microsoft"],
    utm: ["copilot", "copilot.microsoft.com"],
  },
  { id: "claude", name: "Claude", hosts: ["claude.ai"], utm: ["claude", "claude.ai"] },
  { id: "meta", name: "Meta AI", hosts: ["meta.ai"], utm: ["meta.ai"] },
  {
    id: "deepseek",
    name: "DeepSeek",
    hosts: ["chat.deepseek.com"],
    utm: ["deepseek"],
  },
  { id: "grok", name: "Grok", hosts: ["grok.com"], utm: ["grok"] },
];

function hostOf(url) {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

const hostMatches = (host, hosts) =>
  Boolean(host) &&
  hosts.some((item) => host === item || host.endsWith(`.${item}`));

/**
 * @param {{ referrerUrl?: string|null, source?: string|null, utmSource?: string|null }} visit
 * @returns the AI platform the visit came from, or null
 */
export function classifyVisit(visit) {
  if (!visit) return null;
  const host = hostOf(visit.referrerUrl);
  const utm = String(visit.utmSource || "").trim().toLowerCase();
  const source = String(visit.source || "").trim().toLowerCase();
  return (
    AI_PLATFORMS.find(
      (platform) =>
        hostMatches(host, platform.hosts) ||
        (utm && platform.utm.includes(utm)) ||
        (source && hostMatches(source, platform.hosts)),
    ) ?? null
  );
}

/** Landing page path without the query string, for grouping. */
export function landingPath(url) {
  try {
    return new URL(url).pathname || "/";
  } catch {
    return url ? String(url).split("?")[0] : null;
  }
}

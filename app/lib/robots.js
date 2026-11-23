/**
 * robots.txt parsing, evaluation (RFC 9309) and robots.txt.liquid editing.
 * Pure functions: no network, no Shopify API.
 */
import { GEO_MARKER } from "./constants";

/** Shopify's default robots.txt.liquid, used when the theme has no custom template. */
export const SHOPIFY_DEFAULT_ROBOTS_TEMPLATE = `{% for group in robots.default_groups %}
  {{- group.user_agent }}

  {%- for rule in group.rules -%}
    {{ rule }}
  {%- endfor -%}

  {%- if group.sitemap != blank -%}
    {{ group.sitemap }}
  {%- endif -%}
{% endfor %}`;

const BLOCK_START = "{%- comment -%}geo-app:start{%- endcomment -%}";
const BLOCK_END = "{%- comment -%}geo-app:end{%- endcomment -%}";
const UA_LINE = /^\s*user-agent\s*:\s*([^#]+?)\s*(#.*)?$/i;
const RULE_LINE = /^\s*(allow|disallow|crawl-delay)\s*:/i;

/**
 * Parses robots.txt text into groups.
 * Consecutive User-agent lines share one group; a User-agent after a rule starts a new group.
 * @returns {{ groups: { agents: string[], rules: { type: "allow"|"disallow", path: string }[] }[], sitemaps: string[] }}
 */
export function parseRobots(text) {
  const groups = [];
  const sitemaps = [];
  let current = null;
  let lastWasAgent = false;

  for (const raw of String(text || "").split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    const separator = line.indexOf(":");
    if (separator === -1) continue;

    const key = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();

    if (key === "user-agent") {
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }

    lastWasAgent = false;
    if ((key === "allow" || key === "disallow") && current && value) {
      current.rules.push({ type: key, path: value });
    } else if (key === "sitemap" && value) {
      sitemaps.push(value);
    }
  }

  return { groups, sitemaps };
}

const patternCache = new Map();

function toRegex(pattern) {
  let regex = patternCache.get(pattern);
  if (!regex) {
    const anchored = pattern.endsWith("$");
    const body = anchored ? pattern.slice(0, -1) : pattern;
    const source = body
      .split("*")
      .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
      .join(".*");
    regex = new RegExp(`^${source}${anchored ? "$" : ""}`);
    patternCache.set(pattern, regex);
  }
  return regex;
}

/**
 * Decides whether `agent` may fetch `path`.
 * Uses the group naming the agent, otherwise the `*` group. Longest matching
 * rule wins; on a tie, Allow wins (RFC 9309 section 2.2.2).
 */
export function evaluateRobots(parsed, agent, path) {
  const token = agent.toLowerCase();
  let groups = parsed.groups.filter((group) => group.agents.includes(token));
  let matchedGroup = agent;

  if (!groups.length) {
    groups = parsed.groups.filter((group) => group.agents.includes("*"));
    matchedGroup = "*";
  }

  let best = null;
  for (const group of groups) {
    for (const rule of group.rules) {
      if (!toRegex(rule.path).test(path)) continue;
      const longer = !best || rule.path.length > best.path.length;
      const tieAllow =
        best && rule.path.length === best.path.length && rule.type === "allow";
      if (longer || tieAllow) best = rule;
    }
  }

  return {
    allowed: !best || best.type === "allow",
    rule: best
      ? `${best.type === "allow" ? "Allow" : "Disallow"}: ${best.path}`
      : null,
    group: groups.length ? matchedGroup : null,
  };
}

/** Checks a crawler against several paths. Blocked if any path is disallowed. */
export function checkCrawler(parsed, agent, paths) {
  for (const path of paths) {
    const result = evaluateRobots(parsed, agent, path);
    if (!result.allowed) return { ...result, blockedPath: path };
  }
  return { allowed: true, rule: null, group: null, blockedPath: null };
}

/**
 * Removes the given user-agents from literal groups in robots.txt (or a
 * robots.txt.liquid template). A group left with no user-agent loses its rules too.
 * Liquid-generated lines are left untouched.
 */
export function removeAgents(content, agents) {
  const targets = new Set(agents.map((agent) => agent.toLowerCase()));
  const lines = String(content || "").split(/\r?\n/);
  const output = [];
  const removed = [];
  let index = 0;

  while (index < lines.length) {
    if (!UA_LINE.test(lines[index])) {
      output.push(lines[index]);
      index += 1;
      continue;
    }

    const agentLines = [];
    while (index < lines.length && UA_LINE.test(lines[index])) {
      agentLines.push(lines[index]);
      index += 1;
    }

    const kept = [];
    for (const line of agentLines) {
      const agent = line.match(UA_LINE)[1].toLowerCase();
      (targets.has(agent) ? removed : kept).push(line);
    }

    if (kept.length) {
      output.push(...kept);
      continue;
    }

    while (index < lines.length && RULE_LINE.test(lines[index])) {
      removed.push(lines[index]);
      index += 1;
    }
  }

  return {
    content: output.join("\n"),
    removed: removed.map((line) => line.trim()),
  };
}

export function stripManagedBlock(content) {
  const text = String(content || "");
  const start = text.indexOf(BLOCK_START);
  const end = text.indexOf(BLOCK_END);
  if (start === -1 || end === -1 || end < start) return text;
  return (text.slice(0, start) + text.slice(end + BLOCK_END.length)).replace(
    /\n{3,}/g,
    "\n\n",
  );
}

export function isManagedRobotsTemplate(content) {
  return String(content || "").includes(BLOCK_START);
}

/**
 * Liquid block giving each agent an explicit group: Allow everything, then
 * Shopify's default rules for all crawlers (checkout, cart, admin and so on).
 */
export function buildManagedBlock(agents, blocked = []) {
  if (!agents.length && !blocked.length) return "";
  const groups = agents.map((agent) =>
    [
      `User-agent: ${agent}`,
      "Allow: /",
      "{% for group in robots.default_groups %}{% if group.user_agent.value == '*' %}{% for rule in group.rules %}{{ rule }}",
      "{% endfor %}{% endif %}{% endfor %}",
    ].join("\n"),
  );
  const blockGroups = blocked.map((agent) =>
    [`User-agent: ${agent}`, "Disallow: /"].join("\n"),
  );
  return [
    BLOCK_START,
    agents.length &&
      `# ${GEO_MARKER}: AI search crawlers follow your standard rules`,
    agents.length && groups.join("\n"),
    blocked.length && `# ${GEO_MARKER}: crawlers you opted out of`,
    blocked.length && blockGroups.join("\n"),
    BLOCK_END,
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * Plans the robots.txt.liquid change that lets `agents` crawl the store.
 *
 * 1. Start from the theme's template (or Shopify's default) without our old block.
 * 2. Remove the agents from literal groups, so they fall back to the `*` rules.
 * 3. Simulate that on the live robots.txt; agents still blocked get an explicit group.
 *
 * 4. Agents in `block` (training crawlers the merchant opted out of) get a Disallow group.
 *
 * @param {{ template: string|null, liveText: string, agents: string[], paths: string[], block?: string[] }} input
 */
export function planRobotsFix({ template, liveText, agents, paths, block = [] }) {
  const base = template ?? SHOPIFY_DEFAULT_ROBOTS_TEMPLATE;
  const { content: cleaned, removed } = removeAgents(
    stripManagedBlock(base),
    [...agents, ...block],
  );

  const simulated = parseRobots(removeAgents(liveText, agents).content);
  const explicit = agents.filter(
    (agent) => !checkCrawler(simulated, agent, paths).allowed,
  );
  const managed = buildManagedBlock(explicit, block);

  const content = `${[cleaned.trimEnd(), managed].filter(Boolean).join("\n\n")}\n`;
  const added = [
    ...explicit.flatMap((agent) => [`User-agent: ${agent}`, "Allow: /"]),
    ...block.flatMap((agent) => [`User-agent: ${agent}`, "Disallow: /"]),
  ];

  // Without a custom template there is nothing to remove; only write one if a block is needed.
  const changed =
    template == null
      ? explicit.length + block.length > 0
      : content.trim() !== template.trim();

  return { content, removed, added, explicitAgents: explicit, changed };
}

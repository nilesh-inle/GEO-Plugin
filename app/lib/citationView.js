/**
 * What the AI visibility screens filter by: the period and the AI engines.
 * Shared by the loaders (which read them from the URL) and the screens (which
 * write them), so both sides agree. Client-safe.
 *
 * A period is one of PERIODS ("range=7d") or a custom range
 * ("range=custom&from=2026-10-01&to=2026-10-31", whole days in UTC).
 */
import { AI_TOOL_IDS, getAiTool } from "./aiTools";

const DAY_MS = 86_400_000;

export const PERIODS = [
  { key: "24h", days: 1, label: "Last 24 hours" },
  { key: "7d", days: 7, label: "Last 7 days" },
  { key: "30d", days: 30, label: "Last 30 days" },
  { key: "90d", days: 90, label: "Last 3 months" },
];

export const DEFAULT_PERIOD = "30d";
/** The longest custom range. */
export const MAX_RANGE_DAYS = 120;

const dayKey = (date) => date.toISOString().slice(0, 10);

function parseDay(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value ?? "")) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) || dayKey(date) !== value ? null : date;
}

function presetRange(key, now) {
  const period = PERIODS.find((item) => item.key === key) ?? PERIODS.find((item) => item.key === DEFAULT_PERIOD);
  const to = new Date(now);
  return {
    key: period.key,
    label: period.label,
    days: period.days,
    from: new Date(now - period.days * DAY_MS),
    to,
  };
}

/**
 * The period from the URL's search params. Anything unusual (an unknown key,
 * a missing or reversed date, a range in the future or too long) falls back
 * to the default period.
 * @param {URLSearchParams} params
 * @param {number} [now]
 * @returns {{ key: string, label: string, days: number, from: Date, to: Date }}
 */
export function parseRange(params, now = Date.now()) {
  const key = params.get("range");
  if (key === "custom") {
    const from = parseDay(params.get("from"));
    const day = parseDay(params.get("to"));
    if (from && day && from <= day && from.getTime() <= now) {
      const to = new Date(Math.min(day.getTime() + DAY_MS, now));
      const days = Math.max(1, Math.round((to - from) / DAY_MS));
      if (days <= MAX_RANGE_DAYS)
        return { key: "custom", label: "Custom range", days, from, to };
    }
  }
  return presetRange(key, now);
}

/** The `range` search params that give the same period back. */
export function rangeParams(range) {
  const from = new Date(range.from);
  const to = new Date(range.to);
  return range.key === "custom"
    ? { range: "custom", from: dayKey(from), to: dayKey(new Date(to.getTime() - 1)) }
    : { range: range.key };
}

/** The same length of time right before `range`. */
export function previousRange(range) {
  const from = new Date(range.from);
  const length = new Date(range.to) - from;
  return { from: new Date(from - length), to: from };
}

/** "Oct 24 – Nov 23", in UTC so the server and the browser agree. */
export function rangeDates(range) {
  const format = (date) =>
    new Date(date).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  const from = new Date(range.from);
  const last = new Date(new Date(range.to).getTime() - 1);
  return from.toISOString().slice(0, 10) === dayKey(last)
    ? format(from)
    : `${format(from)} – ${format(last)}`;
}

/** The period's name, or its dates for a custom range. */
export function periodText(range) {
  return range.key === "custom" ? rangeDates(range) : range.label;
}

/**
 * AI engine ids from the URL ("openai,gemini"), in app order, without
 * duplicates or unknown ids. Empty means every engine.
 */
export function parseEngines(value) {
  const wanted = new Set(String(value ?? "").split(","));
  return AI_TOOL_IDS.filter((id) => wanted.has(id));
}

/** "All engines", the engine's name, or how many are selected. */
export function engineLabel(engines) {
  if (!engines.length) return "All engines";
  if (engines.length === 1) return getAiTool(engines[0])?.name ?? engines[0];
  return `${engines.length} engines`;
}

/** The URL query for a period and engine selection. */
export function viewQuery({ range, engines = [] }) {
  const params = new URLSearchParams(rangeParams(range));
  if (engines.length) params.set("tools", engines.join(","));
  return params.toString();
}

/** "Just now", "5 hours ago", "6 days ago". */
export function formatAge(value, now = Date.now()) {
  const minutes = Math.round((now - new Date(value).getTime()) / 60_000);
  if (minutes < 2) return "Just now";
  if (minutes < 60) return `${minutes} minutes ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return hours === 1 ? "1 hour ago" : `${hours} hours ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? "1 day ago" : `${days} days ago`;
}

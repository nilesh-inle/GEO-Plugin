/**
 * The top of the AI visibility page: the period picker and the four summary
 * cards (mention rate, share of voice, average rank, top competitors).
 * Tailwind; see app/styles/citations.css.
 */
import { useState } from "react";
import { rateDelta } from "../lib/citationReport";
import { MAX_RANGE_DAYS, PERIODS, rangeDates, rangeParams } from "../lib/citationView";
import { formatNumber } from "../lib/format";
import { Dropdown, Icon } from "./CitationUi";

const DAY_MS = 86_400_000;
const today = () => new Date().toISOString().slice(0, 10);

// ─── Period ───────────────────────────────────────────────────────────────────

function CustomRange({ range, close, onChange }) {
  const params = rangeParams(range);
  const [from, setFrom] = useState(params.from ?? "");
  const [to, setTo] = useState(params.to ?? "");
  const length = (new Date(`${to}T00:00:00Z`) - new Date(`${from}T00:00:00Z`)) / DAY_MS + 1;
  const error = !from || !to
    ? "Pick both dates."
    : length < 1
      ? "The start date is after the end date."
      : length > MAX_RANGE_DAYS
        ? `Pick at most ${MAX_RANGE_DAYS} days.`
        : null;

  const field = "h-9 w-full rounded-md border border-gray-300 bg-white px-2.5 text-[13px] text-gray-900";
  return (
    <form
      className="flex flex-col gap-3 px-3.5 py-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (error) return;
        close();
        onChange({ range: "custom", from, to });
      }}
    >
      <label className="flex flex-col gap-1 text-xs text-gray-500">
        From
        <input type="date" value={from} max={to || today()} onChange={(event) => setFrom(event.target.value)} className={field} />
      </label>
      <label className="flex flex-col gap-1 text-xs text-gray-500">
        To
        <input type="date" value={to} min={from} max={today()} onChange={(event) => setTo(event.target.value)} className={field} />
      </label>
      {error && (
        <p role="alert" className="text-xs text-red-600">
          {error}
        </p>
      )}
      <button
        type="submit"
        disabled={Boolean(error)}
        className="h-9 rounded-md bg-brand text-[13px] font-medium text-white hover:bg-brand-700 disabled:opacity-50"
      >
        Apply
      </button>
    </form>
  );
}

/**
 * @param {object} props
 * @param {{ key: string, from: Date, to: Date }} props.range
 * @param {boolean} props.comparing the previous period is shown next to the numbers
 * @param {(params: { range: string, from?: string, to?: string }) => void} props.onChange
 */
export function PeriodBar({ range, comparing, onChange }) {
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-2">
      <div role="group" aria-label="Period" className="flex flex-wrap items-center gap-1">
        {PERIODS.map((period) => {
          const active = period.key === range.key;
          return (
            <button
              key={period.key}
              type="button"
              aria-pressed={active}
              onClick={() => onChange({ range: period.key })}
              className={`h-9 rounded-md border px-3 text-[13px] ${active ? "border-brand bg-brand-50 font-medium text-brand-700" : "border-transparent text-gray-700 hover:bg-gray-100"}`}
            >
              {period.label}
            </button>
          );
        })}
        <Dropdown
          label="Custom range"
          icon="calendar"
          active={range.key === "custom"}
          width="w-60"
          align="left"
        >
          {(close) => <CustomRange range={range} close={close} onChange={onChange} />}
        </Dropdown>
      </div>
      <span className="hidden h-5 w-px bg-gray-200 sm:block" aria-hidden="true" />
      <p className="text-[13px] text-gray-500">
        {rangeDates(range)}
        {comparing ? " (vs previous period)" : ""}
      </p>
    </div>
  );
}

// ─── Cards ────────────────────────────────────────────────────────────────────

// The period bar already says "(vs previous period)", so the change sits next
// to the number as a short badge and keeps the words for the tooltip.
function Delta({ change, unit, inverse = false }) {
  if (change == null) return null;
  if (change === 0)
    return (
      <span className="text-xs text-gray-500" title="No change vs previous period">
        No change
      </span>
    );
  const good = inverse ? change < 0 : change > 0;
  return (
    <span
      title="vs previous period"
      className={`inline-flex items-center gap-1 text-xs font-medium ${good ? "text-emerald-600" : "text-red-600"}`}
    >
      <svg viewBox="0 0 8 8" className={`size-2 ${change > 0 ? "" : "rotate-180"}`} aria-hidden="true">
        <path d="M4 1l3.5 6h-7z" fill="currentColor" />
      </svg>
      {`${Math.abs(change)}${unit}`}
      <span className="sr-only">vs previous period</span>
    </span>
  );
}

const CARD = "flex min-w-0 flex-col rounded-xl border border-gray-200 bg-white px-4 py-3.5";

function CardHeading({ icon, label, hint }) {
  return (
    <div className="flex min-w-0 items-center gap-2 text-gray-700">
      <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-brand-50 text-brand">
        <Icon name={icon} className="size-4" />
      </span>
      <h3 className="truncate text-[13px] font-medium">{label}</h3>
      {hint && (
        <span title={hint} className="shrink-0 text-gray-400">
          <Icon name="info" className="size-3.5" />
          <span className="sr-only">{hint}</span>
        </span>
      )}
    </div>
  );
}

function StatCard({ icon, label, hint, value, note, delta }) {
  return (
    <section className={CARD}>
      <CardHeading icon={icon} label={label} hint={hint} />
      <div className="mt-2.5 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <p className="text-[24px] leading-7 font-semibold text-gray-900">{value}</p>
        {delta}
      </div>
      {note && <p className="mt-1 text-xs text-gray-500">{note}</p>}
    </section>
  );
}

const percent = (value) => (value == null ? "–" : `${value}%`);

/**
 * @param {object} props
 * @param {object} props.summary from getPromptCitations
 * @param {boolean} props.comparing the period before is available to compare with
 */
export function SummaryCards({ summary, comparing, loading }) {
  const { mention, voice, rank, top, watched, previous } = summary;
  const mentionChange = comparing ? rateDelta(mention, previous.mention) : null;
  const voiceChange =
    comparing && voice.value != null && previous.voice.value != null
      ? voice.value - previous.voice.value
      : null;
  const rankChange =
    comparing && rank.value != null && previous.rank.value != null
      ? Math.round((rank.value - previous.rank.value) * 10) / 10
      : null;

  // Columns follow the width of the page area, not the browser window: inside
  // the Shopify admin the app frame is much narrower than the viewport.
  return (
    <div className="@container">
      <div
        aria-busy={loading}
        className={`grid grid-cols-1 gap-3 transition-opacity @md:grid-cols-2 @3xl:grid-cols-4 ${loading ? "opacity-60" : ""}`}
      >
        <StatCard
          icon="eye"
          label="Mention rate"
          hint="Share of AI answers that name or link to your store"
          value={percent(mention.value)}
          note={mention.total ? `${formatNumber(mention.part)} of ${formatNumber(mention.total)} answers` : "No answers in this period"}
          delta={<Delta change={mentionChange} unit=" pts" />}
        />

        <StatCard
          icon="pie"
          label="Share of Voice"
          hint="Your mentions as a share of your mentions plus your competitors' mentions"
          value={percent(voice.value)}
          note={
            watched
              ? voice.total
                ? `${formatNumber(voice.brand)} of ${formatNumber(voice.total)} brand mentions`
                : "No mentions in this period"
              : "Needs watched competitors"
          }
          delta={<Delta change={voiceChange} unit=" pts" />}
        />

        <StatCard
          icon="rank"
          label="Average rank"
          hint="Where your store's link sits among the sources of an answer, 1 being the first. Only answers that link to your store count."
          value={rank.value == null ? "–" : `#${rank.value}`}
          note={
            rank.samples
              ? `${formatNumber(rank.samples)} ${rank.samples === 1 ? "answer links" : "answers link"} to your store`
              : "No links to your store yet"
          }
          delta={<Delta change={rankChange} unit="" inverse />}
        />

        <section className={CARD}>
          <CardHeading icon="users" label="Top competitors" />
          {top.length ? (
            <ol className="mt-2.5 flex flex-col gap-1.5">
              {top.map((competitor, index) => (
                <li key={competitor.name} className="flex items-center gap-2 text-[13px]">
                  <span className="w-4 text-gray-400">{index + 1}</span>
                  <span className="min-w-0 flex-1 truncate text-gray-900" title={competitor.name}>
                    {competitor.name}
                  </span>
                  <span className="text-xs text-gray-500" title={`Named in ${competitor.answers} answers`}>
                    {competitor.answers ? percent(competitor.share.value) : "–"}
                  </span>
                </li>
              ))}
            </ol>
          ) : (
            <p className="mt-2.5 text-[13px] text-gray-500">No competitors are watched yet.</p>
          )}
        </section>
      </div>
    </div>
  );
}
/**
 * The citation table: one row per prompt, with filters for the period, the
 * prompt's tag and the AI engines. Clicking a row opens the prompt's details.
 * Period and engines are filters on the page's data (they reload it); search,
 * tags, columns, sorting and paging work on the rows already loaded.
 */
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { PROMPT_KINDS } from "../lib/constants";
import { formatNumber } from "../lib/format";
import {
  BUTTON,
  Badge,
  CheckRow,
  DataTable,
  Dropdown,
  EmptyBox,
  EngineAvatar,
  EngineStack,
  Icon,
  Pagination,
  SearchBox,
  useTable,
} from "./CitationUi";

const dash = <span className="text-gray-400">–</span>;

/** Prompt table columns. `ctx.watched` is how many competitors are watched. */
const COLUMNS = [
  {
    key: "prompt",
    label: "Prompt",
    required: true,
    sortValue: (row) => row.text.toLowerCase(),
    render: (row) => (
      <div className="flex min-w-0 items-center gap-2">
        <button
          type="button"
          title={row.text}
          aria-haspopup="dialog"
          className="max-w-[320px] truncate text-left font-medium text-gray-900 hover:text-brand-700"
        >
          {row.text}
        </button>
        {!row.selected && <Badge>Archived</Badge>}
      </div>
    ),
  },
  {
    key: "answers",
    label: "Answers",
    hint: "AI answers collected for this prompt in the period",
    sortValue: (row) => row.answers,
    render: (row) => formatNumber(row.answers),
  },
  {
    key: "coverage",
    label: "Brand coverage",
    hint: "Share of answers that name or link to your store",
    sortValue: (row) => row.coverage.value,
    render: (row) =>
      row.answers ? (
        <span title={`${row.mentioned} of ${row.answers} answers`}>{`${row.coverage.value}%`}</span>
      ) : (
        dash
      ),
  },
  {
    key: "mentions",
    label: "Brand mentions",
    hint: "Answers that name or link to your store",
    sortValue: (row) => row.mentioned,
    render: (row) => formatNumber(row.mentioned),
  },
  {
    key: "domain",
    label: "Domain citations",
    hint: "Links to your store's pages. A store named without a link counts once per answer.",
    sortValue: (row) => row.domainCitations,
    render: (row) => (
      <span className={row.domainCitations ? "font-medium text-gray-900" : ""}>
        {formatNumber(row.domainCitations)}
      </span>
    ),
  },
  {
    key: "total",
    label: "Total citations",
    hint: "Every source the answers link to, yours and others",
    sortValue: (row) => row.totalCitations,
    render: (row) => formatNumber(row.totalCitations),
  },
  {
    key: "competitors",
    label: "Competitors",
    hint: "Watched competitors these answers cite",
    sortValue: (row) => row.competitors.length,
    render: (row, ctx) => {
      if (!ctx.watched) return <span className="text-gray-400">N/A</span>;
      if (!row.competitors.length) return dash;
      const [first, second, ...rest] = row.competitors;
      return (
        <div className="flex items-center gap-1">
          {[first, second].filter(Boolean).map((competitor) => (
            <span
              key={competitor.name}
              title={`${competitor.name}: cited in ${competitor.answers} answers`}
              className="max-w-[110px] truncate rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-700"
            >
              {competitor.name}
            </span>
          ))}
          {rest.length > 0 && <span className="text-xs text-gray-500">{`+${rest.length}`}</span>}
        </div>
      );
    },
  },
  {
    key: "engines",
    label: "AI engines",
    hint: "AI engines that answered this prompt",
    sortValue: (row) => row.providers.length,
    render: (row) => <EngineStack ids={row.providers} />,
  },
];

const OPTIONAL_COLUMNS = COLUMNS.filter((column) => !column.required);

/** Orders `ids` like `options` so the same selection always gives the same URL. */
const inOrder = (options, ids) => options.map((option) => option.id).filter((id) => ids.includes(id));

/**
 * @param {object} props
 * @param {Array} props.rows prompt rows from buildPromptRows
 * @param {number} props.watchedCompetitors competitors with a website
 * @param {string[]} props.engines selected AI engine ids, empty for all
 * @param {Array} props.engineOptions AI engines: { id, name, tracked, connected }
 * @param {boolean} props.loading the page is reloading
 * @param {string} [props.heading] title of the table's header
 * @param {import("react").ReactNode} [props.actions] controls at the right of the header
 * @param {Array<{ key: string, label: string, count: number }>} [props.tabs] row groups
 * @param {string} [props.tab] the key of the group shown
 * @param {(key: string) => void} [props.onTab]
 * @param {(change: { engines: string[] }) => void} props.onChange
 * @param {(row: object) => void} props.onOpen
 * @param {() => void} props.onExport
 */
export function CitationsTable({
  rows,
  watchedCompetitors,
  engines,
  engineOptions,
  loading,
  heading,
  actions,
  tabs = [],
  tab,
  onTab,
  onChange,
  onOpen,
  onExport,
}) {
  const [query, setQuery] = useState("");
  const [kinds, setKinds] = useState([]);
  const [hidden, setHidden] = useState([]);
  // Applies at once; the page catches up when its data has reloaded.
  const [picked, setPicked] = useState(engines);
  const enginesKey = engines.join(",");
  useEffect(() => setPicked(enginesKey ? enginesKey.split(",") : []), [enginesKey]);

  const columns = useMemo(
    () => COLUMNS.filter((column) => column.required || !hidden.includes(column.key)),
    [hidden],
  );
  const kindOptions = useMemo(() => [...new Set(rows.map((row) => row.kind))], [rows]);
  const filtered = useMemo(() => {
    const text = query.trim().toLowerCase();
    return rows.filter(
      (row) =>
        (!kinds.length || kinds.includes(row.kind)) &&
        (!text || row.text.toLowerCase().includes(text)),
    );
  }, [rows, query, kinds]);
  const table = useTable(filtered, columns, { sortKey: "domain", pageSize: 20 });

  const tracked = engineOptions.filter((option) => option.tracked);
  const untracked = engineOptions.filter((option) => !option.tracked);
  const selected = picked.length ? picked : tracked.map((option) => option.id);
  const toggleEngine = (id) => {
    const next = selected.includes(id)
      ? selected.filter((item) => item !== id)
      : [...selected, id];
    if (!next.length) return;
    const all = tracked.every((option) => next.includes(option.id));
    const value = all ? [] : inOrder(engineOptions, next);
    setPicked(value);
    onChange({ engines: value });
  };

  const toggleKind = (kind) =>
    setKinds((current) =>
      current.includes(kind) ? current.filter((item) => item !== kind) : [...current, kind],
    );
  const toggleColumn = (key) =>
    setHidden((current) =>
      current.includes(key) ? current.filter((item) => item !== key) : [...current, key],
    );

  return (
    <section
      aria-busy={loading}
      className={`rounded-xl border border-gray-200 bg-white transition-opacity ${loading ? "opacity-60" : ""}`}
    >
      {(heading || actions) && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-100 px-4 py-3.5">
          <h2 className="text-base font-semibold text-gray-900">{heading}</h2>
          <div className="flex flex-wrap items-center gap-4">{actions}</div>
        </div>
      )}

      {tabs.length > 0 && (
        <div role="tablist" aria-label="Prompts" className="flex flex-wrap gap-2 px-4 pt-3.5">
          {tabs.map((item) => {
            const active = item.key === tab;
            return (
              <button
                key={item.key}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => onTab?.(item.key)}
                className={`inline-flex h-8 items-center gap-2 rounded-full border px-3.5 text-[13px] ${active ? "border-gray-900 bg-gray-900 font-medium text-white" : "border-gray-200 bg-white text-gray-700 hover:bg-gray-50"}`}
              >
                {item.label}
                <span className={active ? "text-gray-300" : "text-gray-400"}>{item.count}</span>
              </button>
            );
          })}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 p-3">
        <Dropdown label="Tags" count={kinds.length} width="w-52">
          {kindOptions.length ? (
            <>
              {kindOptions.map((kind) => (
                <CheckRow key={kind} checked={kinds.includes(kind)} onChange={() => toggleKind(kind)}>
                  {PROMPT_KINDS[kind] ?? kind}
                </CheckRow>
              ))}
              {kinds.length > 0 && (
                <button
                  type="button"
                  onClick={() => setKinds([])}
                  className="mt-1 w-full border-t border-gray-100 px-3 pt-2 pb-1 text-left text-xs text-brand hover:underline"
                >
                  Clear tags
                </button>
              )}
            </>
          ) : (
            <p className="px-3 py-2 text-xs text-gray-500">No prompts yet.</p>
          )}
        </Dropdown>

        <Dropdown
          label="AI engines"
          count={picked.length && picked.length < tracked.length ? picked.length : 0}
          width="w-64"
        >
          <CheckRow
            checked={selected.length === tracked.length}
            disabled={!tracked.length}
            onChange={() => {
              setPicked([]);
              onChange({ engines: [] });
            }}
          >
            <span className="font-medium">All tracked engines</span>
          </CheckRow>
          {tracked.length > 0 && (
            <>
              <p className="px-3 pt-2.5 pb-1 text-xs text-gray-400">Tracked</p>
              {tracked.map((option) => (
                <CheckRow
                  key={option.id}
                  checked={selected.includes(option.id)}
                  onChange={() => toggleEngine(option.id)}
                >
                  <EngineAvatar id={option.id} className="size-5" />
                  {option.name}
                </CheckRow>
              ))}
            </>
          )}
          {untracked.length > 0 && (
            <>
              <p className="px-3 pt-2.5 pb-1 text-xs text-gray-400">Not tracked</p>
              {untracked.map((option) => (
                <div key={option.id} className="flex items-center gap-2.5 px-3 py-1.5 text-[13px] text-gray-600">
                  <EngineAvatar id={option.id} className="size-5 opacity-60" />
                  <span className="flex-1">{option.name}</span>
                  <Link
                    to="/app/settings/tools"
                    className="rounded border border-gray-200 px-1.5 py-0.5 text-[11px] text-gray-600 hover:bg-gray-50"
                  >
                    Connect
                  </Link>
                </div>
              ))}
            </>
          )}
          <Link
            to="/app/settings/tools"
            className="mt-1.5 flex items-center gap-2 border-t border-gray-100 px-3 pt-2.5 pb-1.5 text-[13px] text-gray-700 hover:text-brand-700"
          >
            <Icon name="sliders" className="size-4" />
            Manage engines
          </Link>
        </Dropdown>

        <div className="ml-auto flex items-center gap-2">
          <Dropdown icon="columns" ariaLabel="Choose columns" align="right" width="w-52">
            <CheckRow checked disabled>
              Prompt
            </CheckRow>
            {OPTIONAL_COLUMNS.map((column) => (
              <CheckRow
                key={column.key}
                checked={!hidden.includes(column.key)}
                onChange={() => toggleColumn(column.key)}
              >
                {column.label}
              </CheckRow>
            ))}
          </Dropdown>
          <button type="button" onClick={onExport} className={BUTTON}>
            <Icon name="download" className="size-4 text-gray-600" />
            Export
          </button>
          <SearchBox value={query} onChange={setQuery} placeholder="Search by prompt" />
        </div>
      </div>

      <DataTable
        columns={columns}
        table={table}
        rowKey={(row) => row.id}
        ctx={{ watched: watchedCompetitors }}
        onRowClick={onOpen}
        minWidth="min-w-[860px]"
        empty={
          <EmptyBox title="No prompts match">
            Try another search, tag or period, or add a prompt.
          </EmptyBox>
        }
      />
      <Pagination table={table} label="results" />

      <p className="border-t border-gray-100 px-4 py-3 text-xs leading-5 text-gray-400">
        Brand coverage: answers that name or link to your store. Domain citations: links to your
        store&apos;s pages. Total citations: every source the answers link to. Select a prompt to
        see its answers, the sources they cite and how competitors compare. Google AI Overviews
        has no public API, so Gemini with Google Search stands in for Google.
      </p>
    </section>
  );
}

/**
 * One prompt's details: overview (totals, competitor ranking, brand coverage
 * by week), every AI answer, and the pages those answers cite. Shown in the
 * side panel (PromptPreview) and on the prompt's own page. Tailwind, inside
 * an element with the `geo-ui` class.
 */
import { useState } from "react";
import { engineLabel, formatAge } from "../lib/citationView";
import { formatDate, formatDateTime, formatNumber, truncateText } from "../lib/format";
import {
  BUTTON,
  Badge,
  Card,
  Chip,
  DataTable,
  EmptyBox,
  EngineAvatar,
  EngineStack,
  Icon,
  Pagination,
  useTable,
} from "./CitationUi";
import { downloadCsv } from "./ui";

const TABS = [
  { key: "overview", label: "Overview", icon: "file" },
  { key: "responses", label: "Responses", icon: "chat" },
  { key: "citations", label: "Citations", icon: "branch" },
];

const percent = (value) => (value == null ? "–" : `${value}%`);

/**
 * @param {{ detail: object, engines: string[], period: string }} props
 * `detail` is from buildPromptDetail, `period` names the period shown
 */
export function PromptDetails({ detail, engines = [], period }) {
  const [tab, setTab] = useState("overview");
  const counts = { responses: detail.responses.length, citations: detail.citations.length };

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex flex-wrap gap-2">
        <Chip>{period}</Chip>
        <Chip>{engineLabel(engines)}</Chip>
      </div>

      <div className="rounded-lg border border-gray-200 bg-white p-4">
        <div className="mb-2 flex items-center gap-1.5 text-xs text-gray-500">
          <Icon name="terminal" className="size-3.5" />
          Prompt
        </div>
        <p className="text-[14px] leading-5 text-gray-900">{detail.prompt.text}</p>
      </div>

      <div role="tablist" aria-label="Prompt details" className="flex gap-6 border-b border-gray-200">
        {TABS.map((item) => {
          const active = item.key === tab;
          return (
            <button
              key={item.key}
              id={`prompt-tab-${item.key}`}
              type="button"
              role="tab"
              aria-selected={active}
              aria-controls="prompt-panel"
              onClick={() => setTab(item.key)}
              className={`-mb-px flex items-center gap-1.5 border-b-2 px-0.5 pb-2.5 text-[13px] font-medium ${active ? "border-brand text-brand" : "border-transparent text-gray-600 hover:text-gray-900"}`}
            >
              <Icon name={item.icon} className="size-4" />
              {item.label}
              {counts[item.key] > 0 && (
                <span className="text-xs font-normal text-gray-400">{counts[item.key]}</span>
              )}
            </button>
          );
        })}
      </div>

      <div id="prompt-panel" role="tabpanel" aria-labelledby={`prompt-tab-${tab}`}>
        {tab === "overview" && <Overview detail={detail} />}
        {tab === "responses" && <Responses detail={detail} />}
        {tab === "citations" && <Citations detail={detail} />}
      </div>
    </div>
  );
}

// ─── Overview ─────────────────────────────────────────────────────────────────

function Stat({ label, value, hint }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <div className="text-xs text-gray-500">{label}</div>
      <div className="mt-1.5 text-[15px] font-semibold text-gray-900">{value}</div>
      {hint && <div className="mt-0.5 text-xs text-gray-400">{hint}</div>}
    </div>
  );
}

function Overview({ detail }) {
  const { totals, ranking, history } = detail;
  const none = !totals.answers;
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Stat
          label="Answers"
          value={formatNumber(totals.answers)}
          hint={detail.engines.length ? `From ${detail.engines.length} AI engines` : "No answers yet"}
        />
        <Stat
          label="Brand coverage"
          value={none ? "–" : percent(totals.coverage.value)}
          hint={none ? null : `${totals.mentioned} of ${totals.answers} answers name or link to you`}
        />
        <Stat label="My brand mentions" value={formatNumber(totals.mentioned)} />
        <Stat
          label="My domain citations"
          value={formatNumber(totals.domainCitations)}
          hint={
            none
              ? null
              : `${totals.cited} of ${totals.answers} answers cite your site (${percent(totals.citationRate.value)})`
          }
        />
        <Stat label="Total citations" value={formatNumber(totals.totalCitations)} />
        <Stat
          label="Competitors"
          value={totals.watchedCompetitors ? `${totals.competitorsCited} cited` : "N/A"}
          hint={totals.watchedCompetitors ? `${totals.watchedCompetitors} watched` : "None watched yet"}
        />
      </div>

      <Card title="Competitor ranking">
        {none ? (
          <EmptyBox />
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[520px] text-left text-[13px]">
              <thead>
                <tr className="border-y border-gray-200 bg-gray-50 text-xs text-gray-500">
                  <th scope="col" className="w-12 px-4 py-2.5">
                    #
                  </th>
                  <th scope="col" className="px-3 py-2.5">
                    Brand
                  </th>
                  <th scope="col" className="px-3 py-2.5">
                    Brand coverage
                  </th>
                  <th scope="col" className="px-3 py-2.5">
                    Mentions
                  </th>
                  <th scope="col" className="px-3 py-2.5">
                    Citations
                  </th>
                </tr>
              </thead>
              <tbody>
                {ranking.map((entry, index) => (
                  <tr key={entry.key} className="border-b border-gray-100 last:border-b-0">
                    <td className="px-4 py-2.5 text-gray-500">{index + 1}</td>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-gray-900">{entry.name}</span>
                        {entry.you && <Badge tone="brand">You</Badge>}
                        {entry.domain && (
                          <span className="hidden text-xs text-gray-400 sm:inline">{entry.domain}</span>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-2.5">{percent(entry.coverage.value)}</td>
                    <td className="px-3 py-2.5">{formatNumber(entry.mentions)}</td>
                    <td className="px-3 py-2.5">{formatNumber(entry.citations)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!totals.watchedCompetitors && (
              <p className="border-t border-gray-100 px-4 py-3 text-xs text-gray-500">
                No competitors are watched, so only your store is ranked.
              </p>
            )}
          </div>
        )}
      </Card>

      <Card title="Brand coverage over time">
        <div className="px-4 pb-4 pt-2">
          {none ? <EmptyBox /> : <CoverageChart points={history} />}
          {!none && (
            <p className="mt-1 text-xs text-gray-400">
              Each bar is one week: the share of answers that name or link to your store. A grey tick
              is a week with no answers.
            </p>
          )}
        </div>
      </Card>
    </div>
  );
}

function CoverageChart({ points }) {
  const width = 960;
  const height = 220;
  const pad = { top: 14, right: 12, bottom: 30, left: 40 };
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;
  const slot = innerW / points.length;
  const barW = Math.min(48, slot * 0.55);
  const y = (value) => pad.top + innerH - (value / 100) * innerH;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label="Brand coverage by week"
      className="block w-full"
    >
      {[0, 50, 100].map((tick) => (
        <g key={tick}>
          <line
            x1={pad.left}
            x2={width - pad.right}
            y1={y(tick)}
            y2={y(tick)}
            className="stroke-gray-200"
          />
          <text
            x={pad.left - 8}
            y={y(tick) + 4}
            textAnchor="end"
            className="fill-gray-500 text-[11px]"
          >
            {`${tick}%`}
          </text>
        </g>
      ))}
      {points.map((point, index) => {
        const x = pad.left + slot * index + (slot - barW) / 2;
        const label = `Week of ${formatDate(point.start)}`;
        return (
          <g key={point.start.toString()}>
            {point.coverage.value == null ? (
              <line
                x1={x}
                x2={x + barW}
                y1={y(0)}
                y2={y(0)}
                strokeWidth="3"
                className="stroke-gray-300"
              >
                <title>{`${label}: no answers`}</title>
              </line>
            ) : (
              <rect
                x={x}
                y={y(point.coverage.value)}
                width={barW}
                height={Math.max(2, y(0) - y(point.coverage.value))}
                rx="3"
                className="fill-brand"
              >
                <title>{`${label}: ${point.coverage.value}% (${point.mentioned} of ${point.answers} answers)`}</title>
              </rect>
            )}
            <text
              x={x + barW / 2}
              y={height - 9}
              textAnchor="middle"
              className="fill-gray-500 text-[11px]"
            >
              {formatDate(point.start)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

// ─── Responses ────────────────────────────────────────────────────────────────

const yesNo = (value) => <Badge tone={value ? "success" : "danger"}>{value ? "Yes" : "No"}</Badge>;

const RESPONSE_COLUMNS = [
  {
    key: "response",
    label: "AI responses",
    sortValue: (row) => row.platform,
    render: (row, ctx) => (
      <div className="flex items-center gap-2.5">
        <Icon
          name="chevronRight"
          className={`size-3.5 text-gray-400 transition-transform ${ctx.open === row.id ? "rotate-90" : ""}`}
        />
        <EngineAvatar id={row.provider} className="size-5" />
        <button
          type="button"
          aria-expanded={ctx.open === row.id}
          title="Show the full answer"
          className="max-w-[420px] truncate text-left text-gray-900"
        >
          {truncateText(row.text, 140) || "No answer text"}
        </button>
      </div>
    ),
  },
  {
    key: "mentioned",
    label: "Brand mentioned",
    hint: "The answer names or links to your store",
    sortValue: (row) => Number(row.mentioned),
    render: (row) => yesNo(row.mentioned),
  },
  {
    key: "cited",
    label: "Domain cited",
    hint: "The answer links to your site or writes out its domain",
    sortValue: (row) => Number(row.cited),
    render: (row) => yesNo(row.cited),
  },
  {
    key: "competitors",
    label: "Competitors",
    sortValue: (row) => row.competitors.length,
    render: (row, ctx) => {
      if (!ctx.watched) return <span className="text-gray-400">N/A</span>;
      return row.competitors.length ? (
        <span className="text-gray-800">{row.competitors.join(", ")}</span>
      ) : (
        <span className="text-gray-400">–</span>
      );
    },
  },
  {
    key: "date",
    label: "Run date",
    sortValue: (row) => new Date(row.createdAt).getTime(),
    render: (row) => (
      <span title={formatDateTime(row.createdAt)} suppressHydrationWarning className="whitespace-nowrap">
        {formatAge(row.createdAt)}
      </span>
    ),
  },
];

function Responses({ detail }) {
  const [open, setOpen] = useState(null);
  const table = useTable(detail.responses, RESPONSE_COLUMNS, { sortKey: "date", pageSize: 10 });

  const exportCsv = () =>
    downloadCsv(
      "geo-prompt-answers.csv",
      ["Date", "Prompt", "AI engine", "Brand mentioned", "Domain cited", "Competitors cited", "Sources", "Answer"],
      detail.responses.map((row) => [
        new Date(row.createdAt).toISOString().slice(0, 10),
        detail.prompt.text,
        row.platform,
        row.mentioned ? "Yes" : "No",
        row.cited ? "Yes" : "No",
        row.competitors.join("; "),
        row.sources.map((source) => source.url ?? source.host).join("; "),
        row.text,
      ]),
    );

  return (
    <Card
      title="AI Search engines responses"
      action={
        <button type="button" onClick={exportCsv} disabled={!detail.responses.length} className={BUTTON}>
          <Icon name="download" className="size-4 text-gray-600" />
          Export
        </button>
      }
    >
      <div className="mt-3">
        <DataTable
          columns={RESPONSE_COLUMNS}
          table={table}
          rowKey={(row) => row.id}
          ctx={{ open, watched: detail.totals.watchedCompetitors }}
          onRowClick={(row) => setOpen((current) => (current === row.id ? null : row.id))}
          isExpanded={(row) => open === row.id}
          renderExpanded={(row) => <ResponseBody response={row} />}
          minWidth="min-w-[720px]"
          empty={<EmptyBox title="No answers in this period" />}
        />
        <Pagination table={table} label="results" />
      </div>
    </Card>
  );
}

function ResponseBody({ response }) {
  return (
    <div className="flex flex-col gap-3 pt-2">
      <p className="text-xs text-gray-500">
        {`${response.platform} · ${response.model} · ${formatDateTime(response.createdAt)}`}
      </p>
      <p className="max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-md border border-gray-200 bg-white p-3 text-[13px] leading-5 text-gray-800">
        {response.text || "The answer has no text."}
      </p>
      {response.sources.length > 0 && (
        <div>
          <p className="mb-1.5 text-xs font-medium text-gray-500">{`Sources (${response.sources.length})`}</p>
          <ul className="flex flex-col gap-1.5">
            {response.sources.map((source) => (
              <li key={`${source.host}${source.url}`} className="flex flex-wrap items-center gap-2 text-[13px]">
                <a
                  href={source.url}
                  target="_blank"
                  rel="noreferrer"
                  className="max-w-[440px] truncate text-blue-700 hover:underline"
                >
                  {source.title || source.host || source.url}
                </a>
                <span className="text-xs text-gray-400">{source.host}</span>
                {source.isStore && <Badge tone="success">Your store</Badge>}
                {source.competitor && <Badge tone="warning">{source.competitor}</Badge>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// ─── Citations ────────────────────────────────────────────────────────────────

function CategoryCell({ page }) {
  if (page.category === "Your store") return <Badge tone="success">Your store</Badge>;
  if (page.category === "Competitor") return <Badge tone="warning">Competitor</Badge>;
  return <span className="text-gray-700">{page.category}</span>;
}

const CITATION_COLUMNS = [
  {
    key: "url",
    label: "URL",
    sortValue: (page) => (page.title || page.host).toLowerCase(),
    render: (page) => (
      <div className="min-w-0 max-w-[420px]">
        <div className="truncate font-medium text-gray-900" title={page.title || page.host}>
          {page.title || page.host}
        </div>
        {page.url ? (
          <a
            href={page.url}
            target="_blank"
            rel="noreferrer"
            title={page.url}
            className="block truncate text-xs text-gray-500 hover:text-brand-700 hover:underline"
          >
            {page.url}
          </a>
        ) : (
          <div className="text-xs text-gray-400">Link hidden by Gemini</div>
        )}
      </div>
    ),
  },
  {
    key: "cited",
    label: "Cited",
    hint: "Answers that link to this page",
    sortValue: (page) => page.cited,
    render: (page) => <span className="font-medium text-gray-900">{page.cited}</span>,
  },
  {
    key: "engines",
    label: "AI engines",
    sortValue: (page) => page.engines.length,
    render: (page) => <EngineStack ids={page.engines} />,
  },
  {
    key: "category",
    label: "Domain category",
    sortValue: (page) => page.category,
    render: (page) => <CategoryCell page={page} />,
  },
  {
    key: "host",
    label: "Domain",
    sortValue: (page) => page.host,
    render: (page) => (
      <span className="block max-w-[220px] truncate text-gray-700" title={page.host}>
        {page.host}
      </span>
    ),
  },
  {
    key: "competitors",
    label: "Competitors",
    sortValue: (page) => page.competitor ?? "",
    render: (page) =>
      page.competitor ? (
        <span className="text-gray-800">{page.competitor}</span>
      ) : (
        <span className="text-gray-400">N/A</span>
      ),
  },
];

function Citations({ detail }) {
  const table = useTable(detail.citations, CITATION_COLUMNS, { sortKey: "cited", pageSize: 10 });
  return (
    <Card title="Prompt citations by url">
      <div className="mt-3">
        <DataTable
          columns={CITATION_COLUMNS}
          table={table}
          rowKey={(page) => page.key}
          minWidth="min-w-[860px]"
          empty={
            <EmptyBox title="No citations">
              None of the answers in this period linked to a source.
            </EmptyBox>
          }
        />
        <Pagination table={table} label="results" />
      </div>
    </Card>
  );
}

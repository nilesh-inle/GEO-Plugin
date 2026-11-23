/**
 * Building blocks for the citation screens, styled with Tailwind (see
 * app/styles/citations.css). Use them inside an element with the `geo-ui`
 * class, which sets the font and the few base styles Tailwind's reset would.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { getAiTool } from "../lib/aiTools";

// ─── Icons ────────────────────────────────────────────────────────────────────

const ICONS = {
  chevronDown: <path d="M5 7.5l5 5 5-5" />,
  chevronLeft: <path d="M12 5l-5 5 5 5" />,
  chevronRight: <path d="M8 5l5 5-5 5" />,
  search: (
    <>
      <circle cx="9" cy="9" r="5.5" />
      <path d="M13.5 13.5L17 17" />
    </>
  ),
  close: <path d="M5 5l10 10M15 5L5 15" />,
  columns: (
    <>
      <rect x="3" y="3.5" width="14" height="13" rx="1.5" />
      <path d="M8 3.5v13M12.5 3.5v13" />
    </>
  ),
  download: <path d="M10 3.5v9m0 0L6.5 9M10 12.5L13.5 9M4 16h12" />,
  inbox: (
    <>
      <path d="M3 11l2-6h10l2 6v4a1 1 0 01-1 1H4a1 1 0 01-1-1v-4z" />
      <path d="M3 11h4l1 2h4l1-2h4" />
    </>
  ),
  file: (
    <>
      <path d="M6 3h5.5L15 6.5V16a1 1 0 01-1 1H6a1 1 0 01-1-1V4a1 1 0 011-1z" />
      <path d="M11 3v4h4" />
    </>
  ),
  chat: (
    <path d="M4 5a1 1 0 011-1h10a1 1 0 011 1v7a1 1 0 01-1 1H9l-3.5 3v-3H5a1 1 0 01-1-1V5z" />
  ),
  branch: (
    <>
      <circle cx="6" cy="5" r="1.8" />
      <circle cx="6" cy="15" r="1.8" />
      <circle cx="14" cy="8" r="1.8" />
      <path d="M6 6.8v6.4M14 9.8c0 2.5-2 3-5 3.2" />
    </>
  ),
  terminal: (
    <>
      <rect x="3" y="4" width="14" height="12" rx="1.5" />
      <path d="M6.5 8l2.5 2-2.5 2M11 12.5h3" />
    </>
  ),
  sliders: (
    <>
      <path d="M4 6h8M16 6h0M4 14h2M10 14h6" />
      <circle cx="14" cy="6" r="1.8" />
      <circle cx="8" cy="14" r="1.8" />
    </>
  ),
  external: <path d="M8 4H5a1 1 0 00-1 1v10a1 1 0 001 1h10a1 1 0 001-1v-3M11 4h5v5M16 4l-7 7" />,
  check: <path d="M5 10.5l3.5 3.5L15.5 6.5" />,
  plus: <path d="M10 4.5v11M4.5 10h11" />,
  arrowLeft: <path d="M16 10H4.5m0 0L9 5.5M4.5 10L9 14.5" />,
  info: (
    <>
      <circle cx="10" cy="10" r="7" />
      <path d="M10 9.5v4M10 6.8v.1" />
    </>
  ),
  calendar: (
    <>
      <rect x="3.5" y="4.5" width="13" height="12" rx="1.5" />
      <path d="M3.5 8.5h13M7 3v3M13 3v3" />
    </>
  ),
  eye: (
    <>
      <path d="M1.8 10S5 4.5 10 4.5 18.2 10 18.2 10 15 15.5 10 15.5 1.8 10 1.8 10z" />
      <circle cx="10" cy="10" r="2.3" />
    </>
  ),
  pie: (
    <>
      <path d="M10 3.5a6.5 6.5 0 106.5 6.5H10V3.5z" />
      <path d="M12.5 2.8A6.5 6.5 0 0117.2 7.5h-4.7V2.8z" />
    </>
  ),
  rank: (
    <>
      <path d="M6.5 16.5v-5M10 16.5v-10M13.5 16.5v-7" />
      <path d="M4 16.5h12" />
    </>
  ),
  users: (
    <>
      <circle cx="7.5" cy="7" r="2.5" />
      <path d="M2.8 16c.4-2.6 2.4-4 4.7-4s4.3 1.4 4.7 4" />
      <path d="M12.8 4.7a2.5 2.5 0 010 4.6M14.5 12.2c1.5.5 2.5 1.7 2.7 3.8" />
    </>
  ),
  bolt: <path d="M11 2.5L4.5 11H10l-1 6.5L15.5 9H10l1-6.5z" />,
  tag: (
    <>
      <path d="M3.5 3.5h6l7 7-6 6-7-7v-6z" />
      <circle cx="7" cy="7" r="1" />
    </>
  ),
};

export function Icon({ name, className = "size-4" }) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={`shrink-0 ${className}`}
    >
      {ICONS[name]}
    </svg>
  );
}

// ─── Small pieces ─────────────────────────────────────────────────────────────

/** Google's favicon service: the icon a site shows in the browser tab. */
export const faviconUrl = (host, size = 64) =>
  `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=${size}`;

/** A site's icon, or its first letter when the icon can't be loaded. */
export function Favicon({ host, className = "size-5" }) {
  const [failed, setFailed] = useState(false);
  if (failed)
    return (
      <span
        aria-hidden="true"
        className={`inline-grid shrink-0 place-items-center rounded bg-gray-200 text-[10px] font-semibold text-gray-600 ${className}`}
      >
        {host.slice(0, 1).toUpperCase()}
      </span>
    );
  return (
    <img
      src={faviconUrl(host)}
      alt=""
      loading="lazy"
      onError={() => setFailed(true)}
      className={`shrink-0 rounded ${className}`}
    />
  );
}

// The coloured letter is the fallback when a tool's logo can't be loaded.
const ENGINE_COLORS = {
  openai: "bg-emerald-600",
  perplexity: "bg-cyan-700",
  gemini: "bg-blue-500",
  anthropic: "bg-orange-500",
  cursor: "bg-gray-900",
};
const ENGINE_LETTERS = {
  openai: "C",
  perplexity: "P",
  gemini: "G",
  anthropic: "C",
  cursor: "Cu",
};

/**
 * An AI engine's logo (its site's favicon), with its name as the tooltip.
 * Decorative: every caller shows the name next to it, or reads it out itself.
 * Rounded squares, not circles: some logos fill their whole tile and a circle
 * would clip them.
 */
export function EngineAvatar({ id, className = "size-6" }) {
  const tool = getAiTool(id);
  const name = tool?.name ?? id;
  const [failed, setFailed] = useState(false);
  if (tool?.domain && !failed)
    return (
      <img
        src={faviconUrl(tool.domain)}
        alt=""
        title={name}
        loading="lazy"
        onError={() => setFailed(true)}
        className={`inline-block shrink-0 rounded-[25%] bg-white object-contain ${className}`}
      />
    );
  return (
    <span
      aria-hidden="true"
      title={name}
      className={`inline-grid shrink-0 place-items-center rounded-[25%] text-[10px] font-semibold leading-none text-white ${className} ${ENGINE_COLORS[id] ?? "bg-gray-500"}`}
    >
      {ENGINE_LETTERS[id] ?? name.slice(0, 1).toUpperCase()}
    </span>
  );
}

/** Overlapping engine logos, e.g. the engines that answered a prompt. */
export function EngineStack({ ids }) {
  if (!ids.length) return <span className="text-gray-400">–</span>;
  return (
    <span className="flex items-center -space-x-1.5">
      {/* First, not last: space-x skips the last child, which must be a logo. */}
      <span className="sr-only">{ids.map((id) => getAiTool(id)?.name ?? id).join(", ")}</span>
      {ids.map((id) => (
        <EngineAvatar key={id} id={id} className="size-5 ring-2 ring-white" />
      ))}
    </span>
  );
}

const BADGE_TONES = {
  success: "bg-emerald-50 text-emerald-700",
  danger: "bg-red-50 text-red-600",
  warning: "bg-amber-50 text-amber-700",
  brand: "bg-brand-50 text-brand-700",
  info: "bg-blue-50 text-blue-700",
  neutral: "bg-gray-100 text-gray-600",
};

export function Badge({ tone = "neutral", children }) {
  return (
    <span
      className={`inline-flex items-center whitespace-nowrap rounded px-2 py-0.5 text-xs font-medium leading-4 ${BADGE_TONES[tone]}`}
    >
      {children}
    </span>
  );
}

export function Chip({ children }) {
  return (
    <span className="inline-flex items-center rounded-md border border-gray-200 bg-white px-2.5 py-1 text-xs text-gray-700">
      {children}
    </span>
  );
}

export function EmptyBox({ title = "No data", children }) {
  return (
    <div className="flex flex-col items-center justify-center gap-1.5 px-4 py-10 text-center">
      <Icon name="inbox" className="size-9 text-gray-300" />
      <p className="text-[13px] font-medium text-gray-500">{title}</p>
      {children && <p className="max-w-sm text-xs text-gray-400">{children}</p>}
    </div>
  );
}

export function Skeleton({ className = "" }) {
  return <div className={`animate-pulse rounded bg-gray-100 ${className}`} />;
}

export function Card({ title, action, children }) {
  return (
    <section className="rounded-lg border border-gray-200 bg-white">
      {(title || action) && (
        <div className="flex items-center justify-between gap-3 px-4 pt-4">
          {title && <h3 className="text-[15px] font-semibold text-gray-900">{title}</h3>}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

// ─── Toolbar controls ─────────────────────────────────────────────────────────

/** Outlined toolbar button. */
export const BUTTON =
  "inline-flex h-9 items-center gap-2 rounded-md border border-gray-300 bg-white px-3 text-[13px] text-gray-800 hover:bg-gray-50";

/** A button that opens a floating panel, closed by a click outside or Escape. */
export function Dropdown({
  label,
  ariaLabel,
  icon,
  count = 0,
  active = false,
  align = "left",
  width = "w-60",
  children,
}) {
  const [open, setOpen] = useState(false);
  const root = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onPointer = (event) => {
      if (!root.current?.contains(event.target)) setOpen(false);
    };
    const onKey = (event) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        aria-haspopup="true"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={() => setOpen((value) => !value)}
        className={`${BUTTON} ${active ? "!border-brand !bg-brand-50 !text-brand-700" : open ? "border-gray-400 bg-gray-50" : ""} ${label ? "" : "w-9 justify-center px-0"}`}
      >
        {icon && <Icon name={icon} className="size-4 text-gray-600" />}
        {label}
        {count > 0 && (
          <span className="grid min-w-5 place-items-center rounded-full bg-brand px-1.5 text-[11px] font-semibold leading-5 text-white">
            {count}
          </span>
        )}
        {label && <Icon name="chevronDown" className="size-3.5 text-gray-500" />}
      </button>
      {open && (
        <div
          className={`absolute top-full z-30 mt-1.5 ${width} rounded-lg border border-gray-200 bg-white py-1.5 shadow-lg ${align === "right" ? "right-0" : "left-0"}`}
        >
          {typeof children === "function" ? children(() => setOpen(false)) : children}
        </div>
      )}
    </div>
  );
}

/** A row in a dropdown with a checkbox. */
export function CheckRow({ checked, onChange, disabled, children }) {
  return (
    <label
      className={`flex items-center gap-2.5 px-3 py-1.5 text-[13px] ${disabled ? "cursor-not-allowed text-gray-400" : "cursor-pointer text-gray-800 hover:bg-gray-50"}`}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={onChange}
        className="size-4 shrink-0 accent-brand"
      />
      {children}
    </label>
  );
}

export function SearchBox({ value, onChange, placeholder }) {
  return (
    <div className="relative flex h-9 w-full min-w-48 max-w-72 items-center rounded-md border border-gray-300 bg-white focus-within:border-brand focus-within:ring-1 focus-within:ring-brand">
      <input
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className="h-full min-w-0 flex-1 rounded-l-md bg-transparent px-3 text-[13px] text-gray-900 placeholder:text-gray-400 focus:outline-none [&::-webkit-search-cancel-button]:hidden"
      />
      <span className="grid h-full w-9 shrink-0 place-items-center border-l border-gray-200 text-gray-500">
        <Icon name="search" className="size-4" />
      </span>
    </div>
  );
}

// ─── Table ────────────────────────────────────────────────────────────────────

const compare = (a, b) => {
  if (typeof a === "string" || typeof b === "string")
    return String(a ?? "").localeCompare(String(b ?? ""));
  return (a ?? -Infinity) - (b ?? -Infinity);
};

/**
 * Sorting and paging for a table. `columns` need a `sortValue(row)` to be
 * sortable. Sorting a new column starts high to low, like the reference.
 */
export function useTable(rows, columns, { sortKey = null, sortDir = "desc", pageSize = 20 } = {}) {
  const [sort, setSort] = useState({ key: sortKey, dir: sortDir });
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(pageSize);

  const sorted = useMemo(() => {
    const column = columns.find((item) => item.key === sort.key);
    if (!column?.sortValue) return rows;
    const direction = sort.dir === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => compare(column.sortValue(a), column.sortValue(b)) * direction);
  }, [rows, columns, sort]);

  const pages = Math.max(1, Math.ceil(sorted.length / size));
  const current = Math.min(page, pages);

  return {
    rows: sorted.slice((current - 1) * size, current * size),
    total: sorted.length,
    sort,
    toggleSort: (key) => {
      setSort((previous) =>
        previous.key === key
          ? { key, dir: previous.dir === "asc" ? "desc" : "asc" }
          : { key, dir: "desc" },
      );
      setPage(1);
    },
    page: current,
    setPage,
    pageSize: size,
    setPageSize: (value) => {
      setSize(value);
      setPage(1);
    },
  };
}

function SortIcon({ dir }) {
  return (
    <svg viewBox="0 0 8 12" className="h-3 w-2 shrink-0" aria-hidden="true">
      <path d="M4 0l3.5 4.5h-7z" className={dir === "asc" ? "fill-brand" : "fill-gray-300"} />
      <path d="M4 12L.5 7.5h7z" className={dir === "desc" ? "fill-brand" : "fill-gray-300"} />
    </svg>
  );
}

/**
 * Table with sortable headers. Columns: { key, label, hint?, sortValue?,
 * render(row, ctx), className? }. Pass `table` from useTable.
 */
export function DataTable({
  columns,
  table,
  rowKey,
  ctx,
  onRowClick,
  isExpanded,
  renderExpanded,
  empty,
  minWidth = "min-w-[760px]",
}) {
  return (
    <div className="overflow-x-auto">
      <table className={`w-full ${minWidth} text-left text-[13px]`}>
        <thead>
          <tr className="border-y border-gray-200 bg-gray-50">
            {columns.map((column) => {
              const sorted = table.sort.key === column.key ? table.sort.dir : null;
              return (
                <th
                  key={column.key}
                  scope="col"
                  aria-sort={
                    column.sortValue
                      ? sorted === "asc"
                        ? "ascending"
                        : sorted === "desc"
                          ? "descending"
                          : "none"
                      : undefined
                  }
                  className="whitespace-nowrap px-3 py-2.5 text-xs text-gray-500"
                >
                  {column.sortValue ? (
                    <button
                      type="button"
                      onClick={() => table.toggleSort(column.key)}
                      title={column.hint}
                      className="inline-flex items-center gap-1.5 hover:text-gray-800"
                    >
                      <span
                        className={
                          column.hint
                            ? "underline decoration-gray-400 decoration-dotted underline-offset-4"
                            : ""
                        }
                      >
                        {column.label}
                      </span>
                      <SortIcon dir={sorted} />
                    </button>
                  ) : (
                    <span
                      title={column.hint}
                      className={
                        column.hint
                          ? "underline decoration-gray-400 decoration-dotted underline-offset-4"
                          : ""
                      }
                    >
                      {column.label}
                    </span>
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {table.rows.map((row) => {
            const key = rowKey(row);
            const open = isExpanded?.(row);
            return (
              <FragmentRow
                key={key}
                row={row}
                columns={columns}
                ctx={ctx}
                onClick={onRowClick}
                open={open}
                renderExpanded={renderExpanded}
              />
            );
          })}
        </tbody>
      </table>
      {!table.rows.length && empty}
    </div>
  );
}

function FragmentRow({ row, columns, ctx, onClick, open, renderExpanded }) {
  return (
    <>
      {/* Keyboard users use the button inside the row's first cell. */}
      {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-noninteractive-element-interactions */}
      <tr
        onClick={onClick ? () => onClick(row) : undefined}
        className={`border-b border-gray-100 ${onClick ? "cursor-pointer hover:bg-gray-50" : ""} ${open ? "bg-gray-50" : ""}`}
      >
        {columns.map((column) => (
          <td key={column.key} className={`px-3 py-2.5 align-middle ${column.className ?? ""}`}>
            {column.render(row, ctx)}
          </td>
        ))}
      </tr>
      {open && renderExpanded && (
        <tr className="border-b border-gray-100 bg-gray-50">
          <td colSpan={columns.length} className="px-4 pb-4 pt-1">
            {renderExpanded(row)}
          </td>
        </tr>
      )}
    </>
  );
}

function pageList(page, pages) {
  if (pages <= 7) return Array.from({ length: pages }, (_, index) => index + 1);
  const wanted = [...new Set([1, pages, page - 1, page, page + 1])]
    .filter((value) => value >= 1 && value <= pages)
    .sort((a, b) => a - b);
  const list = [];
  wanted.forEach((value, index) => {
    if (index && value - wanted[index - 1] > 1) list.push("…");
    list.push(value);
  });
  return list;
}

const PAGE_SIZES = [10, 20, 50];

const PAGER_BUTTON =
  "grid size-7 place-items-center rounded-md border text-xs disabled:opacity-40";

/** "Viewing 1-9 of 9 results", page buttons and a page size picker. */
export function Pagination({ table, label = "results" }) {
  const { total, page, pageSize } = table;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = total ? (page - 1) * pageSize + 1 : 0;
  const to = Math.min(total, page * pageSize);

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-3 py-3 text-xs text-gray-500">
      <span>{total ? `Viewing ${from}-${to} of ${total} ${label}` : `No ${label}`}</span>
      <div className="flex items-center gap-2">
        <nav aria-label="Pagination" className="flex items-center gap-1">
          <button
            type="button"
            aria-label="Previous page"
            disabled={page <= 1}
            onClick={() => table.setPage(page - 1)}
            className={`${PAGER_BUTTON} border-transparent text-gray-500 hover:bg-gray-100`}
          >
            <Icon name="chevronLeft" className="size-3.5" />
          </button>
          {pageList(page, pages).map((item, index) =>
            item === "…" ? (
              <span key={`gap-${index}`} className="px-1 text-gray-400">
                …
              </span>
            ) : (
              <button
                key={item}
                type="button"
                aria-current={item === page ? "page" : undefined}
                onClick={() => table.setPage(item)}
                className={`${PAGER_BUTTON} ${item === page ? "border-brand font-semibold text-brand" : "border-transparent text-gray-600 hover:bg-gray-100"}`}
              >
                {item}
              </button>
            ),
          )}
          <button
            type="button"
            aria-label="Next page"
            disabled={page >= pages}
            onClick={() => table.setPage(page + 1)}
            className={`${PAGER_BUTTON} border-transparent text-gray-500 hover:bg-gray-100`}
          >
            <Icon name="chevronRight" className="size-3.5" />
          </button>
        </nav>
        <select
          aria-label="Rows per page"
          value={pageSize}
          onChange={(event) => table.setPageSize(Number(event.target.value))}
          className="h-8 rounded-md border border-gray-300 bg-white px-2 text-xs text-gray-700"
        >
          {PAGE_SIZES.map((size) => (
            <option key={size} value={size}>
              {`${size} / page`}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

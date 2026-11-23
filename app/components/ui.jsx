/**
 * Small building blocks shared by the hub screens. Polaris web components
 * only, plus inline SVG for charts (Polaris has no chart component).
 */
import { EVIDENCE, IMPACT } from "../lib/issues";

/** Tabs for a hub (AI access, AI visibility, Settings). Each tab is its own route. */
export function HubTabs({ tabs, current }) {
  return (
    <s-box paddingBlockEnd="small">
      <s-stack direction="inline" gap="small-200">
        {tabs.map((tab) => {
          const active = tab.key === current;
          return (
            <s-button
              key={tab.key}
              href={tab.href}
              variant={active ? "secondary" : "tertiary"}
              accessibilityLabel={
                active ? `${tab.label}, current tab` : tab.label
              }
            >
              {tab.count != null ? `${tab.label} · ${tab.count}` : tab.label}
            </s-button>
          );
        })}
      </s-stack>
    </s-box>
  );
}

/**
 * KPI tile: label, big value, optional badge and one line of context. With
 * `href` the whole tile is a link, and `action` names where it goes.
 */
export function Metric({
  label,
  value,
  badge,
  badgeTone = "info",
  help,
  href,
  action,
  children,
}) {
  const body = (
    <s-stack direction="block" gap="small-200">
      <s-stack direction="inline" gap="small-200" alignItems="center">
        <s-text color="subdued">{label}</s-text>
        {badge && <s-badge tone={badgeTone}>{badge}</s-badge>}
      </s-stack>
      <s-heading>{value}</s-heading>
      {help && <s-text color="subdued">{help}</s-text>}
      {children}
      {href && action && <s-text type="strong" tone="info">{`${action} →`}</s-text>}
    </s-stack>
  );
  if (href) {
    return (
      <s-clickable
        href={href}
        accessibilityLabel={`${label}: ${value}. ${action ?? "Open"}`}
        padding="base"
        background="base"
        borderRadius="base"
        border="base"
      >
        {body}
      </s-clickable>
    );
  }
  return (
    <s-box padding="base" background="base" borderRadius="base" border="base">
      {body}
    </s-box>
  );
}

/**
 * Small bar chart for a KPI tile: one bar per period, no axes. Periods with
 * no data show a flat grey tick.
 * @param {{ points: Array<{ label: string, value: number|null, detail?: string }>, label: string }} props
 */
export function Sparkline({ points, label, height = 36 }) {
  const width = 240;
  const max = Math.max(10, ...points.map((point) => point.value ?? 0));
  const slot = width / Math.max(points.length, 1);
  const barW = Math.max(2, slot * 0.6);
  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width="100%"
      height={height}
      preserveAspectRatio="none"
      role="img"
      aria-label={label}
      style={{ display: "block" }}
    >
      {points.map((point, index) => {
        const x = index * slot + (slot - barW) / 2;
        const barH =
          point.value == null ? 2 : Math.max(2, (point.value / max) * (height - 2));
        return (
          <rect
            key={point.label}
            x={x}
            y={height - barH}
            width={barW}
            height={barH}
            rx="1.5"
            fill={point.value == null ? "#D4D4D4" : "#2A78D6"}
          >
            <title>
              {point.value == null
                ? `${point.label}: no answers`
                : `${point.label}: ${point.value}%${point.detail ? ` (${point.detail})` : ""}`}
            </title>
          </rect>
        );
      })}
    </svg>
  );
}

export function MetricGrid({ children, min = 200 }) {
  return (
    <s-grid
      gridTemplateColumns={`repeat(auto-fit, minmax(${min}px, 1fr))`}
      gap="base"
    >
      {children}
    </s-grid>
  );
}

export function ImpactBadge({ impact }) {
  const item = IMPACT[impact];
  if (!item) return null;
  return <s-badge tone={item.tone}>{item.label}</s-badge>;
}

export function EvidenceBadge({ evidence }) {
  const item = EVIDENCE[evidence];
  if (!item) return null;
  return (
    <s-badge tone={item.tone} icon="info">
      {item.label}
    </s-badge>
  );
}

/** Area meter: label, score and a progress bar. */
export function Meter({ label, value, suffix, tone }) {
  const known = value != null;
  return (
    <s-stack direction="block" gap="small-300">
      <s-stack direction="inline" justifyContent="space-between" gap="base">
        <s-text>{label}</s-text>
        <s-text type="strong">
          {known ? value : "–"}
          {suffix ? <s-text color="subdued">{` · ${suffix}`}</s-text> : null}
        </s-text>
      </s-stack>
      <s-progress
        value={known ? value : 0}
        max={100}
        tone={tone ?? (!known ? "neutral" : value >= 80 ? "success" : value >= 50 ? "auto" : "critical")}
        accessibilityLabel={`${label}: ${known ? `${value} out of 100` : "not checked"}`}
      />
    </s-stack>
  );
}

/**
 * Bar chart of a percentage per period. Bars use one colour; empty periods
 * are drawn as a baseline tick so gaps read as "no data", not zero.
 * `width` is the drawing width: wider keeps labels smaller on a full-width page.
 * @param {{ points: Array<{ label: string, value: number|null, detail?: string }> }} props
 */
export function TrendBars({ points, height = 140, label, width = 640 }) {
  const pad = { top: 12, right: 8, bottom: 26, left: 34 };
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;
  const max = Math.max(
    10,
    Math.ceil(Math.max(...points.map((point) => point.value ?? 0)) / 10) * 10,
  );
  const slot = innerW / Math.max(points.length, 1);
  const barW = Math.min(36, slot * 0.6);
  const y = (value) => pad.top + innerH - (value / max) * innerH;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width="100%"
      role="img"
      aria-label={label}
      style={{ display: "block", maxWidth: "100%" }}
    >
      {[0, max / 2, max].map((tick) => (
        <g key={tick}>
          <line
            x1={pad.left}
            x2={width - pad.right}
            y1={y(tick)}
            y2={y(tick)}
            stroke="#E3E3E3"
            strokeWidth="1"
          />
          <text
            x={pad.left - 6}
            y={y(tick) + 4}
            textAnchor="end"
            fontSize="11"
            fill="#616161"
          >
            {`${Math.round(tick)}%`}
          </text>
        </g>
      ))}
      {points.map((point, index) => {
        const x = pad.left + slot * index + (slot - barW) / 2;
        return (
          <g key={point.label}>
            {point.value == null ? (
              <line
                x1={x}
                x2={x + barW}
                y1={y(0)}
                y2={y(0)}
                stroke="#B5B5B5"
                strokeWidth="2"
              />
            ) : (
              <rect
                x={x}
                y={y(point.value)}
                width={barW}
                height={Math.max(1, y(0) - y(point.value))}
                rx="3"
                fill="#2A78D6"
              >
                <title>{`${point.label}: ${point.value}%${point.detail ? ` (${point.detail})` : ""}`}</title>
              </rect>
            )}
            <text
              x={x + barW / 2}
              y={height - 8}
              textAnchor="middle"
              fontSize="11"
              fill="#616161"
            >
              {point.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

/** Horizontal bars, one per row: label, bar, value text. */
export function RowBars({ rows, max = 100, unit = "%" }) {
  return (
    <s-stack direction="block" gap="small">
      {rows.map((row) => (
        <s-stack key={row.label} direction="block" gap="small-300">
          <s-stack direction="inline" justifyContent="space-between" gap="base">
            <s-text>{row.label}</s-text>
            <s-text type="strong">
              {row.value == null ? (row.empty ?? "–") : `${row.value}${unit}`}
              {row.detail ? (
                <s-text color="subdued">{` · ${row.detail}`}</s-text>
              ) : null}
            </s-text>
          </s-stack>
          <s-progress
            value={row.value ?? 0}
            max={max}
            tone="info"
            accessibilityLabel={`${row.label}: ${row.value ?? 0}${unit}`}
          />
        </s-stack>
      ))}
    </s-stack>
  );
}

/** Admin deep link that App Bridge opens in the Shopify admin. */
export function adminProductUrl(id) {
  return `shopify://admin/products/${String(id).split("/").pop()}`;
}

/** In-page filter tabs (client state), styled like HubTabs. */
export function FilterTabs({ tabs, current, onSelect }) {
  return (
    <s-stack direction="inline" gap="small-200">
      {tabs.map((tab) => {
        const active = tab.key === current;
        return (
          <s-button
            key={tab.key}
            variant={active ? "secondary" : "tertiary"}
            onClick={() => onSelect(tab.key)}
            accessibilityLabel={active ? `${tab.label}, selected` : tab.label}
          >
            {tab.count != null ? `${tab.label} · ${tab.count}` : tab.label}
          </s-button>
        );
      })}
    </s-stack>
  );
}

/** Downloads rows as a CSV file in the browser. */
export function downloadCsv(filename, header, rows) {
  const escape = (value) => {
    const text = String(value ?? "");
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const csv = [header, ...rows].map((row) => row.map(escape).join(",")).join("\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

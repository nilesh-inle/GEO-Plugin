import { useMemo, useRef, useState } from "react";
import { useFetcher, useLoaderData, useNavigation, useSubmit } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { readBody, requireStore } from "../services/guard.server";
import { getFixList, setIssueStatus } from "../services/issues.server";
import { getLatestRun, startSync } from "../services/sync.server";
import {
  EvidenceBadge,
  FilterTabs,
  ImpactBadge,
  Metric,
  MetricGrid,
  downloadCsv,
} from "../components/ui";
import { useElementEvent } from "../hooks/useElementEvent";
import { AREAS, EVIDENCE, IMPACT } from "../lib/issues";
import { FIX_STATUS, RUN_STATUS } from "../lib/constants";
import { formatDateTime } from "../lib/format";
import { getManualTemplates } from "../services/fixes.server";
import { ManualTemplates } from "../components/ManualTemplates";

const AREA_NAMES = {
  robots: "robots.txt",
  llms: "llms.txt",
  schema: "Product schema",
};

export const loader = async ({ request }) => {
  const { shop, store } = await requireStore(request);
  const [list, run] = await Promise.all([getFixList(shop), getLatestRun(shop)]);
  const failures = Object.keys(AREA_NAMES)
    .filter((area) => store[`${area}Status`] === FIX_STATUS.FAILED)
    .map((area) => ({
      area: AREA_NAMES[area],
      message: store.fixState[area]?.message ?? "Something went wrong.",
    }));
  return {
    ...list,
    running: run?.status === RUN_STATUS.RUNNING,
    manual: getManualTemplates(store, shop),
    failures,
  };
};

export const action = async ({ request }) => {
  const { shop, redirect } = await requireStore(request);
  const body = await readBody(request);
  if (body.intent === "rerun") {
    await startSync(shop);
    return redirect("/app/optimize/sync");
  }
  if (body.intent === "dismiss" || body.intent === "reopen") {
    await setIssueStatus(
      shop,
      String(body.key),
      body.intent === "dismiss" ? "dismissed" : "open",
    );
    return { ok: true };
  }
  return { ok: false };
};

export default function FixList() {
  const data = useLoaderData();
  const submit = useSubmit();
  const navigation = useNavigation();
  const [tab, setTab] = useState("all");
  const [query, setQuery] = useState("");
  const searchRef = useRef(null);
  useElementEvent(searchRef, "input", (event) =>
    setQuery(event.currentTarget.value ?? ""),
  );
  const rerunning =
    navigation.state !== "idle" && navigation.formData?.get("intent") === "rerun";

  const tabs = [
    { key: "all", label: "All", count: data.open.length },
    ...data.areas.filter((area) => area.count).map((area) => ({
      key: area.key,
      label: area.label,
      count: area.count,
    })),
    { key: "dismissed", label: "Dismissed", count: data.dismissed.length },
  ];

  const rows = useMemo(() => {
    const source = tab === "dismissed" ? data.dismissed : data.open;
    const needle = query.trim().toLowerCase();
    return source.filter(
      (item) =>
        (tab === "all" || tab === "dismissed" || item.area === tab) &&
        (!needle ||
          `${item.title} ${item.description}`.toLowerCase().includes(needle)),
    );
  }, [data, tab, query]);

  const exportCsv = () =>
    downloadCsv(
      "geo-fix-list.csv",
      ["Issue", "Details", "Area", "Affects", "Impact", "Evidence", "Fix type"],
      data.open.map((item) => [
        item.title,
        item.description,
        AREAS[item.area],
        item.affects,
        IMPACT[item.impact].label,
        EVIDENCE[item.evidence].label,
        item.fixType,
      ]),
    );

  return (
    <s-page heading="Fix list" inlineSize="large">
      <s-button
        slot="primary-action"
        variant="primary"
        loading={rerunning || undefined}
        disabled={data.running || undefined}
        onClick={() => submit({ intent: "rerun" }, { method: "post" })}
      >
        Re-run audit
      </s-button>
      {data.appFixable > 0 && (
        <s-button slot="secondary-actions" href="/app/optimize/update">
          Review app fixes
        </s-button>
      )}
      <s-button slot="secondary-actions" onClick={exportCsv}>
        Export CSV
      </s-button>

      <s-stack direction="block" gap="base">
        <s-text color="subdued">
          {data.auditedAt
            ? `Store audit from ${formatDateTime(data.auditedAt)}`
            : "No audit yet"}
        </s-text>

        {data.failures.length > 0 && (
          <s-banner tone="critical" heading="Some changes weren't applied">
            <s-stack direction="block" gap="small-300">
              {data.failures.map((failure) => (
                <s-text key={failure.area}>
                  {failure.area}: {failure.message}
                </s-text>
              ))}
            </s-stack>
            <s-button slot="secondary-actions" href="/app/optimize/update">
              Review app fixes
            </s-button>
          </s-banner>
        )}
        <ManualTemplates templates={data.manual} />
        {data.running && (
          <s-banner tone="info" heading="An audit is running">
            This list updates when it finishes.
            <s-button slot="secondary-actions" href="/app/optimize/sync">
              View progress
            </s-button>
          </s-banner>
        )}
        {data.stale && !data.running && !data.manual.length && (
          <s-banner tone="warning" heading="Run a new audit to check everything">
            GEO now also checks product categories, descriptions, images and
            policies. Re-run the audit to include them.
          </s-banner>
        )}

        <MetricGrid min={150}>
          <Metric label="Critical" value={data.counts.critical} />
          <Metric label="High" value={data.counts.high} />
          <Metric label="Medium" value={data.counts.medium} />
          <Metric label="Low" value={data.counts.low} />
          <Metric
            label="GEO can fix"
            value={data.appFixable}
            help="Applied by the app after you review"
          />
        </MetricGrid>

        <s-section padding="none" accessibilityLabel="Issues">
          <s-box padding="base">
            <s-stack direction="block" gap="base">
              <FilterTabs tabs={tabs} current={tab} onSelect={setTab} />
              <s-search-field
                label="Search issues"
                labelAccessibilityVisibility="exclusive"
                placeholder="Search issues"
                ref={searchRef}
              />
            </s-stack>
          </s-box>
          {rows.length ? (
            <IssueTable rows={rows} dismissed={tab === "dismissed"} />
          ) : (
            <s-box padding="large">
              <s-stack direction="block" gap="small" alignItems="center">
                <s-heading>
                  {tab === "dismissed" ? "Nothing dismissed" : "All clear"}
                </s-heading>
                <s-text color="subdued">
                  {tab === "dismissed"
                    ? "Issues you dismiss are kept here."
                    : data.auditedAt
                      ? `No open issues in this area as of ${formatDateTime(data.auditedAt)}.`
                      : "Run an audit to see issues."}
                </s-text>
              </s-stack>
            </s-box>
          )}
        </s-section>

        <s-text color="subdued">
          Issues are ranked by impact, then by how many products they affect.
          Hypothesis items are never ranked above documented ones of the same
          impact.
        </s-text>
      </s-stack>
    </s-page>
  );
}

function IssueTable({ rows, dismissed }) {
  return (
    <s-table>
      <s-table-header-row>
        <s-table-header listSlot="primary">Issue</s-table-header>
        <s-table-header>Area</s-table-header>
        <s-table-header>Affects</s-table-header>
        <s-table-header>Impact</s-table-header>
        <s-table-header>Evidence</s-table-header>
        <s-table-header>Fix type</s-table-header>
        <s-table-header>Action</s-table-header>
      </s-table-header-row>
      <s-table-body>
        {rows.map((item) => (
          <IssueRow key={item.key} item={item} dismissed={dismissed} />
        ))}
      </s-table-body>
    </s-table>
  );
}

function IssueRow({ item, dismissed }) {
  const fetcher = useFetcher();
  const busy = fetcher.state !== "idle";
  return (
    <s-table-row>
      <s-table-cell>
        <s-stack direction="block" gap="small-300">
          <s-link href={`/app/fixes/${encodeURIComponent(item.key)}`}>
            {item.title}
          </s-link>
          <s-text color="subdued">{item.description}</s-text>
        </s-stack>
      </s-table-cell>
      <s-table-cell>{AREAS[item.area]}</s-table-cell>
      <s-table-cell>{item.affects}</s-table-cell>
      <s-table-cell>
        <ImpactBadge impact={item.impact} />
      </s-table-cell>
      <s-table-cell>
        <EvidenceBadge evidence={item.evidence} />
      </s-table-cell>
      <s-table-cell>{item.fixType}</s-table-cell>
      <s-table-cell>
        {dismissed ? (
          <s-button
            variant="tertiary"
            loading={busy || undefined}
            onClick={() =>
              fetcher.submit(
                { intent: "reopen", key: item.key },
                { method: "post" },
              )
            }
          >
            Restore
          </s-button>
        ) : (
          <s-button
            variant="secondary"
            href={`/app/fixes/${encodeURIComponent(item.key)}`}
          >
            Review
          </s-button>
        )}
      </s-table-cell>
    </s-table-row>
  );
}

export const headers = (headersArgs) => boundary.headers(headersArgs);

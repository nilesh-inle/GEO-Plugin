import { useCallback, useMemo, useState } from "react";
import { useLoaderData, useNavigate, useNavigation } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { readBody, requireStore } from "../services/guard.server";
import { getEngineOptions, getPromptCitations } from "../services/citations.server";
import {
  addPrompts,
  getLatestTrackRun,
  getTrackOverview,
  startTrackRun,
  suggestPrompts,
} from "../services/tracking.server";
import { AddPromptPanel } from "../components/AddPromptPanel";
import { Icon } from "../components/CitationUi";
import { CitationsTable } from "../components/CitationsTable";
import { PromptPreview } from "../components/PromptPreview";
import { TrackRunStatus } from "../components/TrackRunStatus";
import { VisibilityInsights } from "../components/VisibilityInsights";
import { PeriodBar, SummaryCards } from "../components/VisibilitySummary";
import { downloadCsv } from "../components/ui";
import { usePolling } from "../hooks/usePolling";
import { storeDomains, tracksOtherSite } from "../lib/citations";
import { parseEngines, parseRange, rangeParams } from "../lib/citationView";
import { RUN_STATUS, TRACK, TRACK_TRIGGER } from "../lib/constants";
import "../styles/citations.css";

export const loader = async ({ request }) => {
  const { shop, store } = await requireStore(request);
  const url = new URL(request.url);
  const range = parseRange(url.searchParams);
  const engines = parseEngines(url.searchParams.get("tools"));

  const [table, engineOptions, overview] = await Promise.all([
    getPromptCitations(shop, { range, engines }),
    getEngineOptions(shop),
    getTrackOverview(shop),
  ]);
  // What AI-written prompts are based on: the catalog for the store's own
  // domains, the home page for another website set as the Store URL.
  const promptSource = {
    domains: overview.domains,
    basedOn: tracksOtherSite(overview.domains, storeDomains(store, shop)) ? "website" : "catalog",
  };
  return {
    table,
    engineOptions,
    overview,
    promptSource,
    range,
    engines,
    maxPrompts: TRACK.maxPrompts,
  };
};

// Writing suggestions saves nothing, so the page's data needn't reload.
export const shouldRevalidate = ({ json, defaultShouldRevalidate }) =>
  json?.intent === "suggest" ? false : defaultShouldRevalidate;

/**
 * The "Add new prompt" panel:
 *   suggest  a connected AI tool writes prompts for the tracked domains; nothing is saved
 *   add      saves the merchant's prompt and the suggestions they picked. With
 *            `runNow` the tracked ones are asked right away, to the chosen
 *            engines only; the weekly check of the other prompts isn't affected.
 */
export const action = async ({ request }) => {
  const { shop } = await requireStore(request);
  const body = await readBody(request);
  if (body.intent === "suggest") {
    try {
      return { ok: true, ...(await suggestPrompts(shop)) };
    } catch (error) {
      return { error: error.message };
    }
  }
  if (body.intent !== "add") return { error: "Unknown action." };

  const picked = Array.isArray(body.suggestions)
    ? body.suggestions.slice(0, TRACK.suggestions)
    : [];
  const items = [
    ...(String(body.text ?? "").trim() ? [{ text: body.text }] : []),
    ...picked.map((item) => ({ text: item?.text, kind: item?.kind, basis: item?.basis })),
  ];
  if (!items.length) return { error: "Write a prompt or pick one AI wrote." };

  let prompts;
  try {
    prompts = await addPrompts(shop, items);
  } catch (error) {
    return { error: error.message };
  }
  const added = prompts.length;
  const tracked = prompts.filter((prompt) => prompt.selected).map((prompt) => prompt.id);
  if (!body.runNow || !tracked.length) return { ok: true, added, started: false };

  const connected = (await getEngineOptions(shop))
    .filter((option) => option.connected)
    .map((option) => option.id);
  const providers = parseEngines(
    Array.isArray(body.engines) ? body.engines.join(",") : "",
  ).filter((id) => connected.includes(id));
  if (!providers.length) return { ok: true, added, started: false };

  // A check can't start while another one runs.
  const latest = await getLatestTrackRun(shop);
  if (latest?.status === RUN_STATUS.RUNNING)
    return { ok: true, added, started: false, note: "A check is running, so they join the next one." };

  try {
    await startTrackRun(shop, {
      trigger: TRACK_TRIGGER.MANUAL,
      promptIds: tracked,
      providers,
    });
    return { ok: true, added, started: true };
  } catch (error) {
    return { ok: true, added, started: false, note: error.message };
  }
};

/** A switch with a label, as in the "Show archived" control. */
function Switch({ checked, onChange, children }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="inline-flex items-center gap-2 text-[13px] text-gray-700"
    >
      <span
        className={`relative inline-block h-5 w-9 rounded-full transition-colors ${checked ? "bg-brand" : "bg-gray-300"}`}
      >
        <span
          className={`absolute top-0.5 left-0.5 size-4 rounded-full bg-white shadow transition-transform ${checked ? "translate-x-4" : ""}`}
        />
      </span>
      {children}
    </button>
  );
}

const SCOPES = [
  { key: "all", label: "All", match: () => true },
  { key: "suggested", label: "Suggested by GEO", match: (row) => row.kind !== "custom" },
  { key: "yours", label: "Yours", match: (row) => row.kind === "custom" },
];

export default function AiVisibility() {
  const { table, engineOptions, overview, promptSource, range, engines, maxPrompts } =
    useLoaderData();
  const navigate = useNavigate();
  const navigation = useNavigation();
  const loading = navigation.state === "loading";

  const [scope, setScope] = useState("all");
  const [archived, setArchived] = useState(false);
  const [openId, setOpenId] = useState(null);
  const [adding, setAdding] = useState(false);
  const closePreview = useCallback(() => setOpenId(null), []);
  const closeAdd = useCallback(() => setAdding(false), []);

  const running = overview.run?.status === RUN_STATUS.RUNNING;
  usePolling(running, 3000);

  const shown = useMemo(
    () => table.rows.filter((row) => archived || row.selected),
    [table.rows, archived],
  );
  const tabs = SCOPES.map((item) => ({
    key: item.key,
    label: item.label,
    count: shown.filter(item.match).length,
  }));
  const rows = useMemo(
    () => shown.filter((SCOPES.find((item) => item.key === scope) ?? SCOPES[0]).match),
    [shown, scope],
  );

  const go = (params, nextEngines = engines) => {
    const query = new URLSearchParams(params);
    if (nextEngines.length) query.set("tools", nextEngines.join(","));
    navigate(`/app/visibility?${query}`, { preventScrollReset: true });
  };

  const exportCsv = () =>
    downloadCsv(
      `geo-prompts-${range.key === "custom" ? "custom" : range.key}.csv`,
      [
        "Prompt",
        "Answers",
        "Brand coverage (%)",
        "Brand mentions",
        "Domain citations",
        "Total citations",
        "Competitors cited",
        "AI engines",
      ],
      rows.map((row) => [
        row.text,
        row.answers,
        row.coverage.value ?? "",
        row.mentioned,
        row.domainCitations,
        row.totalCitations,
        row.competitors.map((competitor) => competitor.name).join("; "),
        row.providers.join("; "),
      ]),
    );

  return (
    <s-page heading="AI visibility" inlineSize="large">
      <s-stack direction="block" gap="base">
        <TrackRunStatus run={overview.run} nextRunAt={overview.nextRunAt} />

        {!overview.connectedTools && (
          <s-banner tone="info" heading="Connect an AI tool to check prompts">
            <s-paragraph>
              GEO asks your prompts to the AI tools you connect, such as ChatGPT or Gemini.
            </s-paragraph>
            <s-button slot="secondary-actions" href="/app/settings/tools">
              Connect an AI tool
            </s-button>
          </s-banner>
        )}

        <div className="geo-ui flex flex-col gap-4">
          <p className="text-[13px] text-gray-500">
            See the prompts shoppers ask AI assistants and where your store is mentioned.
          </p>

          <PeriodBar
            range={range}
            comparing={table.previousAvailable}
            onChange={(params) => go(params)}
          />
          <SummaryCards summary={table.summary} comparing={table.previousAvailable} loading={loading} />
          <VisibilityInsights breakdown={table.breakdown} loading={loading} />

          <CitationsTable
            rows={rows}
            watchedCompetitors={table.watchedCompetitors}
            engines={engines}
            engineOptions={engineOptions}
            loading={loading}
            heading="All prompts"
            tabs={tabs}
            tab={scope}
            onTab={setScope}
            actions={
              <>
                <Switch checked={archived} onChange={setArchived}>
                  Show archived
                </Switch>
                <button
                  type="button"
                  onClick={() => setAdding(true)}
                  className="inline-flex h-9 items-center gap-1.5 rounded-md bg-brand px-3.5 text-[13px] font-medium text-white hover:bg-brand-700"
                >
                  <Icon name="plus" className="size-4" />
                  Add prompt
                </button>
              </>
            }
            onChange={({ engines: next }) => go(rangeParams(range), next)}
            onOpen={(row) => setOpenId(row.id)}
            onExport={exportCsv}
          />
        </div>
      </s-stack>

      {adding && (
        <AddPromptPanel
          engines={engineOptions}
          answers={overview.answers}
          running={running}
          selectedPrompts={table.selectedPrompts}
          maxPrompts={maxPrompts}
          promptSource={promptSource}
          onClose={closeAdd}
        />
      )}
      {openId && (
        <PromptPreview
          key={openId}
          promptId={openId}
          range={range}
          engines={engines}
          onClose={closePreview}
        />
      )}
    </s-page>
  );
}

export const headers = (headersArgs) => boundary.headers(headersArgs);

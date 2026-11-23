import { useMemo, useState } from "react";
import { useFetcher, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { readBody, requireStore } from "../services/guard.server";
import {
  REACHABILITY_PAGE_TYPES,
  SEARCH_BOTS,
  TRAINING_BOTS,
  applyCrawlerChange,
  getCrawlerState,
  planCrawlerChange,
  runReachabilityCheck,
} from "../services/access.server";
import { getManualTemplates } from "../services/fixes.server";
import { getLatestAudit } from "../services/sync.server";
import { AccessNav } from "../components/HubNav";
import { CodeBlock } from "../components/CodeBlock";
import { ManualTemplates } from "../components/ManualTemplates";
import { Metric, MetricGrid } from "../components/ui";
import { FIX_STATUS } from "../lib/constants";
import { formatDateTime } from "../lib/format";

export const loader = async ({ request }) => {
  const { admin, shop, store } = await requireStore(request);
  const [state, audit] = await Promise.all([
    getCrawlerState(admin, shop, store),
    getLatestAudit(shop),
  ]);
  const byAgent = Object.fromEntries(
    state.robots.crawlers.map((crawler) => [crawler.agent, crawler]),
  );
  const describe = (bot) => ({
    agent: bot.agent,
    tool: bot.tool,
    usedFor: bot.usedFor,
    purpose: bot.purpose,
    allowed: byAgent[bot.agent]?.allowed ?? null,
    rule: byAgent[bot.agent]?.rule ?? null,
    managedBlock: state.saved.blocked.includes(bot.agent),
  });

  return {
    storeUrl: store.url,
    robotsUrl: state.url,
    themeName: state.theme.name,
    live: state.live,
    template: { exists: state.template.exists, managed: state.template.managed },
    search: SEARCH_BOTS.map(describe),
    training: TRAINING_BOTS.map(describe),
    reachability: store.accessState.reachability ?? null,
    passwordProtected: Boolean(audit?.passwordProtected),
    manual: getManualTemplates(store, shop).filter((item) => item.area === "robots"),
    pageTypes: REACHABILITY_PAGE_TYPES,
  };
};

export const action = async ({ request }) => {
  const { admin, shop, store } = await requireStore(request);
  const body = await readBody(request);

  if (body.intent === "reachability") {
    return { reachability: await runReachabilityCheck(shop, store) };
  }

  const choices = body.choices ?? {};
  if (body.intent === "preview") {
    const state = await getCrawlerState(admin, shop, store);
    if (!state.live.ok)
      return { error: "robots.txt couldn't be read. Try again in a minute." };
    const plan = planCrawlerChange(state, choices);
    return {
      preview: {
        changed: plan.changed,
        removed: plan.removed,
        added: plan.added,
        content: plan.content,
      },
    };
  }
  if (body.intent === "apply") {
    try {
      const result = await applyCrawlerChange(admin, shop, store, choices);
      return { applied: result.status };
    } catch (error) {
      return { error: error.message };
    }
  }
  return null;
};

export default function CrawlersPage() {
  const data = useLoaderData();
  const reach = useFetcher();
  const plan = useFetcher();
  const reachability = reach.data?.reachability ?? data.reachability;

  const initial = useMemo(
    () =>
      Object.fromEntries(
        data.training.map((bot) => [bot.agent, bot.allowed === false ? "block" : "allow"]),
      ),
    [data.training],
  );
  const [choices, setChoices] = useState(initial);
  const changed = data.training.filter((bot) => choices[bot.agent] !== initial[bot.agent]);
  const blockedSearch = data.search.filter((bot) => bot.allowed === false);
  const pending = changed.length > 0 || blockedSearch.length > 0;

  const post = (intent) =>
    plan.submit(
      { intent, choices },
      { method: "post", encType: "application/json" },
    );
  const preview = plan.data?.preview;
  const applying = plan.state !== "idle" && plan.json?.intent === "apply";

  const searchAllowed = data.search.filter((bot) => bot.allowed).length;
  const trainingAllowed = data.training.filter((bot) => bot.allowed).length;

  return (
    <s-page heading="AI access" inlineSize="large">
      <s-button
        slot="primary-action"
        variant="primary"
        loading={reach.state !== "idle" || undefined}
        onClick={() => reach.submit({ intent: "reachability" }, { method: "post" })}
      >
        Run reachability check
      </s-button>
      <s-button slot="secondary-actions" href={data.robotsUrl} target="_blank">
        Open robots.txt
      </s-button>

      <s-stack direction="block" gap="base">
        <AccessNav current="crawlers" />
        <s-text color="subdued">
          {`Control which AI crawlers can read and quote ${data.storeUrl.replace(/^https?:\/\//, "")}.`}
        </s-text>

        <ManualTemplates templates={data.manual} />
        {plan.data?.applied === FIX_STATUS.APPLIED && (
          <s-banner tone="success" heading="Crawler rules applied">
            templates/robots.txt.liquid was updated in your live theme. GEO is
            re-checking your store. Crawlers pick up changes within about a day.
          </s-banner>
        )}
        {plan.data?.applied === FIX_STATUS.MANUAL && (
          <s-banner tone="warning" heading="Add the template by hand">
            Shopify didn&apos;t allow the app to edit theme files. Reload this
            page to see the template to copy.
          </s-banner>
        )}
        {plan.data?.error && (
          <s-banner tone="critical" heading="Rules weren't changed">
            {plan.data.error}
          </s-banner>
        )}

        <MetricGrid>
          <Metric
            label="Search & assistant bots"
            value={`${searchAllowed} of ${data.search.length}`}
            help={blockedSearch.length ? `${blockedSearch.length} blocked` : "Allowed by robots.txt"}
          />
          <Metric
            label="Training bots allowed"
            value={`${trainingAllowed} of ${data.training.length}`}
            help="Your choice; doesn't affect AI search"
          />
          <Metric
            label="robots.txt"
            value={data.live.ok ? `HTTP ${data.live.status}` : "Unreachable"}
            help={
              data.template.managed
                ? `Managed by GEO in theme “${data.themeName}”`
                : data.template.exists
                  ? `Custom template in theme “${data.themeName}”`
                  : "Shopify default"
            }
          />
          <Metric
            label="Last reachability check"
            value={reachability ? formatDateTime(reachability.checkedAt) : "Not run"}
            help={
              reachability
                ? `${reachability.fetches} fetches · ${reachability.failures} failures`
                : "Fetches real pages as each bot"
            }
          />
        </MetricGrid>

        {pending && (
          <s-banner
            tone={blockedSearch.length ? "critical" : "info"}
            heading={
              blockedSearch.length
                ? `${blockedSearch.length} AI search ${blockedSearch.length === 1 ? "bot is" : "bots are"} blocked`
                : `${changed.length} unsaved crawler ${changed.length === 1 ? "change" : "changes"}`
            }
          >
            {blockedSearch.length
              ? `${blockedSearch.map((bot) => bot.agent).join(", ")} can't read your store. Review the robots.txt change that lets them in.`
              : "Review the robots.txt change before it's written to your theme."}
            <s-button
              slot="secondary-actions"
              loading={plan.state !== "idle" && plan.json?.intent === "preview" ? true : undefined}
              onClick={() => post("preview")}
            >
              Review robots.txt changes
            </s-button>
            {changed.length > 0 && (
              <s-button slot="secondary-actions" onClick={() => setChoices(initial)}>
                Discard
              </s-button>
            )}
          </s-banner>
        )}

        {preview && (
          <s-section heading="Review robots.txt changes">
            <s-stack direction="block" gap="base">
              {preview.changed ? (
                <CodeBlock
                  maxHeight="320px"
                  lines={[
                    ...preview.removed.map((text) => ({ text, kind: "removed" })),
                    ...preview.added.map((text) => ({ text, kind: "added" })),
                    ...(preview.removed.length || preview.added.length
                      ? []
                      : [{ text: "Removes GEO's rules and keeps your theme's own.", kind: "note" }]),
                  ]}
                />
              ) : (
                <s-paragraph>Nothing to change: robots.txt already matches.</s-paragraph>
              )}
              <s-text color="subdued">
                Written to templates/robots.txt.liquid in your live theme.
                Shopify&apos;s default rules stay in place. The previous version
                is saved in change history.
              </s-text>
              {preview.changed && (
                <s-stack direction="inline" gap="small">
                  <s-button
                    variant="primary"
                    loading={applying || undefined}
                    onClick={() => post("apply")}
                  >
                    Apply to theme
                  </s-button>
                </s-stack>
              )}
            </s-stack>
          </s-section>
        )}

        <s-section heading="AI search and assistant bots">
          <s-stack direction="block" gap="small">
            <s-paragraph>
              These decide whether you can appear and be cited in AI answers.
              GEO always lets them in.
            </s-paragraph>
            <BotTable bots={data.search} />
          </s-stack>
        </s-section>

        <s-section heading="Training bots · your choice">
          <s-stack direction="block" gap="small">
            <s-paragraph>
              Blocking these opts your content out of model training. It
              doesn&apos;t remove you from AI search answers.
            </s-paragraph>
            <BotTable
              bots={data.training}
              choices={choices}
              onChoose={(agent, value) => setChoices({ ...choices, [agent]: value })}
            />
          </s-stack>
        </s-section>

        <Reachability reachability={reachability} pageTypes={data.pageTypes} running={reach.state !== "idle"} />

        <s-section heading="Storefront access">
          <s-stack direction="block" gap="small">
            <AccessRow
              ok={!data.passwordProtected}
              label={data.passwordProtected ? "Storefront password is on" : "No storefront password"}
            />
            <AccessRow
              ok
              label="Pages render on Shopify's servers, so bots see content without running JavaScript"
            />
            {reachability && (
              <AccessRow
                ok={!reachability.bots.some((bot) =>
                  Object.values(bot.pages).some((page) => page.note === "The page says noindex"),
                )}
                label={
                  reachability.bots.some((bot) =>
                    Object.values(bot.pages).some((page) => page.note === "The page says noindex"),
                  )
                    ? "Some sampled pages say noindex"
                    : "No noindex on the sampled pages"
                }
              />
            )}
          </s-stack>
        </s-section>

        <s-section heading="Your live robots.txt">
          <s-stack direction="block" gap="small">
            <s-text color="subdued">
              {`templates/robots.txt.liquid in theme “${data.themeName}”.`}
            </s-text>
            {data.live.text ? (
              <CodeBlock text={data.live.text} maxHeight="360px" />
            ) : (
              <s-text color="subdued">robots.txt couldn&apos;t be read.</s-text>
            )}
          </s-stack>
        </s-section>
      </s-stack>
    </s-page>
  );
}

function BotTable({ bots, choices, onChoose }) {
  return (
    <s-table>
      <s-table-header-row>
        <s-table-header listSlot="primary">Bot</s-table-header>
        <s-table-header>Used for</s-table-header>
        <s-table-header>Status</s-table-header>
        <s-table-header>Access</s-table-header>
      </s-table-header-row>
      <s-table-body>
        {bots.map((bot) => (
          <s-table-row key={bot.agent}>
            <s-table-cell>
              <s-stack direction="block" gap="small-400">
                <s-text type="strong">{bot.agent}</s-text>
                <s-text color="subdued">{bot.tool}</s-text>
              </s-stack>
            </s-table-cell>
            <s-table-cell>{bot.usedFor}</s-table-cell>
            <s-table-cell>
              {bot.allowed == null ? (
                <s-badge tone="neutral">Unknown</s-badge>
              ) : bot.allowed ? (
                <s-badge tone="success">Allowed</s-badge>
              ) : (
                <s-badge tone={choices ? "neutral" : "critical"}>
                  {bot.rule ? `Blocked · ${bot.rule}` : "Blocked"}
                </s-badge>
              )}
            </s-table-cell>
            <s-table-cell>
              {choices ? (
                <s-stack direction="inline" gap="small-300">
                  <s-button
                    variant={choices[bot.agent] === "allow" ? "secondary" : "tertiary"}
                    accessibilityLabel={`Allow ${bot.agent}`}
                    onClick={() => onChoose(bot.agent, "allow")}
                  >
                    Allow
                  </s-button>
                  <s-button
                    variant={choices[bot.agent] === "block" ? "secondary" : "tertiary"}
                    accessibilityLabel={`Block ${bot.agent}`}
                    onClick={() => onChoose(bot.agent, "block")}
                  >
                    Block
                  </s-button>
                </s-stack>
              ) : (
                <s-badge tone="info">Always allowed</s-badge>
              )}
            </s-table-cell>
          </s-table-row>
        ))}
      </s-table-body>
    </s-table>
  );
}

const PAGE_BADGE = {
  ok: "success",
  blocked: "critical",
  password: "warning",
  error: "critical",
};

function Reachability({ reachability, pageTypes, running }) {
  return (
    <s-section heading="Bot reachability check">
      <s-stack direction="block" gap="small">
        <s-paragraph>
          GEO fetches real pages as each bot and checks what comes back, not
          just what robots.txt says.
        </s-paragraph>
        {running && <s-text color="subdued">Fetching pages as each bot…</s-text>}
        {reachability ? (
          <>
            <s-table>
              <s-table-header-row>
                <s-table-header listSlot="primary">Bot</s-table-header>
                {pageTypes.map(([key, label]) => (
                  <s-table-header key={key}>{label}</s-table-header>
                ))}
                <s-table-header format="numeric">Avg time</s-table-header>
                <s-table-header>Content seen</s-table-header>
              </s-table-header-row>
              <s-table-body>
                {reachability.bots.map((bot) => (
                  <s-table-row key={bot.agent}>
                    <s-table-cell>{bot.agent}</s-table-cell>
                    {pageTypes.map(([key]) => {
                      const page = bot.pages[key];
                      return (
                        <s-table-cell key={key}>
                          {page ? (
                            <s-badge tone={PAGE_BADGE[page.outcome]}>
                              {page.outcome === "ok"
                                ? String(page.status)
                                : page.note || String(page.status)}
                            </s-badge>
                          ) : (
                            <s-text color="subdued">–</s-text>
                          )}
                        </s-table-cell>
                      );
                    })}
                    <s-table-cell>
                      {bot.avgMs == null ? "–" : `${(bot.avgMs / 1000).toFixed(2)} s`}
                    </s-table-cell>
                    <s-table-cell>{bot.seen.length ? bot.seen.join(", ") : "–"}</s-table-cell>
                  </s-table-row>
                ))}
              </s-table-body>
            </s-table>
            <s-text color="subdued">
              {`Checked ${formatDateTime(reachability.checkedAt)}. Each bot's user agent is sent from GEO's server. Firewalls that verify real bots by IP address can treat them differently, so a pass is strong evidence, not a guarantee.`}
            </s-text>
          </>
        ) : (
          !running && (
            <s-text color="subdued">
              Not run yet. Run the check to fetch your home, product,
              collection and policy pages as each AI bot.
            </s-text>
          )
        )}
      </s-stack>
    </s-section>
  );
}

function AccessRow({ ok, label }) {
  return (
    <s-stack direction="inline" gap="small" alignItems="center">
      <s-badge tone={ok ? "success" : "warning"}>{ok ? "Ready" : "Needs attention"}</s-badge>
      <s-text>{label}</s-text>
    </s-stack>
  );
}

export const headers = (headersArgs) => boundary.headers(headersArgs);

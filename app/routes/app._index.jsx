import { Suspense } from "react";
import { Await, useLoaderData, useNavigation, useSubmit } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import prisma from "../db.server";
import { authenticate } from "../shopify.server";
import { getStoreOverview } from "../services/catalog.server";
import { listChanges } from "../services/changes.server";
import { getFixList } from "../services/issues.server";
import { getAiPerformance } from "../services/performance.server";
import { getStore, patchStoreJson } from "../services/store.server";
import { getEmbedActivationUrl } from "../services/theme.server";
import { getLatestRun, startSync } from "../services/sync.server";
import { getTrackOverview } from "../services/tracking.server";
import { getVisibilityStats } from "../services/visibility.server";
import {
  EvidenceBadge,
  ImpactBadge,
  Meter,
  Metric,
  MetricGrid,
  RowBars,
  TrendBars,
} from "../components/ui";
import { SetupGuide } from "../components/SetupGuide";
import { RUN_STATUS } from "../lib/constants";
import {
  formatDate,
  formatDateTime,
  formatMoney,
  formatNumber,
  parseJson,
  pluralize,
} from "../lib/format";

export const loader = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const { shop } = session;
  const [store, run] = await Promise.all([getStore(shop), getLatestRun(shop)]);

  if (!store?.syncedAt) {
    return {
      firstRun: true,
      overview: await getStoreOverview(admin),
      syncRunning: run?.status === RUN_STATUS.RUNNING,
    };
  }

  const [fixList, audits, stats, tracking, changes] = await Promise.all([
    getFixList(shop),
    prisma.audit.findMany({
      where: { shop, readiness: { not: null } },
      orderBy: { createdAt: "asc" },
      select: { readiness: true, createdAt: true },
    }),
    getVisibilityStats(shop, { days: 28, weeks: 8 }),
    getTrackOverview(shop),
    listChanges(shop, { take: 4 }),
  ]);

  const first = audits[0];
  const dismissedSetup = Boolean(parseJson(store.settings, {}).setupDismissed);
  return {
    firstRun: false,
    setup: dismissedSetup
      ? null
      : {
          embedEnabled: fixList.embedEnabled,
          embedUrl: getEmbedActivationUrl(shop),
          steps: [
            {
              key: "fix",
              title: "Apply your first fix",
              detail: "Review what stops AI tools from reading your store, then publish the app fixes.",
              done: changes.length > 0,
              href: "/app/fixes",
              label: "Review fixes",
            },
            {
              key: "embed",
              title: "Turn on the schema app embed",
              detail: "Adds product details to your pages in a form AI tools can read. One click in the theme editor.",
              done: false,
              href: "",
              label: "Open theme editor",
            },
            {
              key: "tool",
              title: "Connect an AI tool",
              detail: "Use your own API key to see how often AI assistants name your store.",
              done: tracking.connectedTools > 0,
              href: "/app/settings/tools",
              label: "Connect",
            },
            {
              key: "questions",
              title: "Add prompts to track",
              detail: "Add the questions shoppers ask. Only these are sent to your AI tools.",
              done: tracking.selectedPrompts > 0,
              href: "/app/visibility",
              label: "Add prompts",
            },
            {
              key: "check",
              title: "Run your first visibility check",
              detail: "Ask your questions and see whether answers mention or cite you.",
              done: stats.answers > 0,
              href: "/app/visibility",
              label: "Open AI visibility",
            },
          ],
        },
    store: { name: store.name, currency: store.currency },
    scanRunning: run?.status === RUN_STATUS.RUNNING,
    lastScan: fixList.auditedAt,
    products: fixList.catalog.products,
    readiness: fixList.readiness,
    readinessSince:
      first && audits.length > 1 && fixList.readiness.score != null
        ? { delta: fixList.readiness.score - first.readiness, since: first.createdAt }
        : null,
    issues: fixList.open.slice(0, 5),
    openIssues: fixList.open.length,
    critical: fixList.open.find((item) => item.impact === "critical") ?? null,
    channels: fixList.channels,
    stats,
    tracking: {
      prompts: tracking.selectedPrompts,
      tools: tracking.connectedTools,
      nextRunAt: tracking.nextRunAt,
    },
    changes,
    // Streamed: reading orders can take a few seconds.
    performance: getAiPerformance(admin, shop, { days: 30 }),
  };
};

export const action = async ({ request }) => {
  const { session, redirect } = await authenticate.admin(request);
  const form = await request.formData();
  if (form.get("intent") === "dismissSetup") {
    await patchStoreJson(session.shop, "settings", { setupDismissed: true });
    return { ok: true };
  }
  await startSync(session.shop);
  return redirect("/app/optimize/sync");
};

export default function Index() {
  const data = useLoaderData();
  return data.firstRun ? <Welcome {...data} /> : <Overview data={data} />;
}

// ─── Overview ────────────────────────────────────────────────────────────────

const signed = (value, unit = "") =>
  value == null ? null : `${value > 0 ? "▲" : value < 0 ? "▼" : "±"} ${Math.abs(value)}${unit}`;

const rateText = (rate) =>
  rate.value == null ? "No answers yet" : `${rate.value}% ± ${rate.margin} pts`;

function Overview({ data }) {
  const submit = useSubmit();
  const navigation = useNavigation();
  const starting =
    navigation.state !== "idle" &&
    navigation.formMethod === "POST" &&
    navigation.formData?.get("intent") !== "dismissSetup";
  const { stats, readiness } = data;

  return (
    <s-page heading="Overview" inlineSize="large">
      <s-button slot="primary-action" variant="primary" href="/app/fixes">
        Review fixes
      </s-button>
      <s-button
        slot="secondary-actions"
        loading={starting || undefined}
        disabled={data.scanRunning || undefined}
        onClick={() => submit({}, { method: "post" })}
      >
        Run scan
      </s-button>

      <s-stack direction="block" gap="base">
        <s-text color="subdued">
          {[
            data.lastScan ? `Last scan ${formatDateTime(data.lastScan)}` : "No scan yet",
            pluralize(data.products, "active product"),
            pluralize(data.tracking.prompts, "shopper question") + " tracked",
          ].join(" · ")}
        </s-text>

        {data.scanRunning && (
          <s-stack direction="inline" gap="small" alignItems="center">
            <s-spinner size="base" accessibilityLabel="Scan running" />
            <s-text>
              A scan is running. Numbers update when it finishes.{" "}
              <s-link href="/app/optimize/sync">View progress</s-link>
            </s-text>
          </s-stack>
        )}
        {data.critical && (
          <s-banner tone="critical" heading={data.critical.title}>
            {data.critical.whyItMatters}
            <s-button
              slot="secondary-actions"
              href={`/app/fixes/${encodeURIComponent(data.critical.key)}`}
            >
              Fix it
            </s-button>
          </s-banner>
        )}

        {data.setup && (
          <SetupGuide
            steps={data.setup.steps}
            embedFallback={data.setup.embedEnabled}
            embedUrl={data.setup.embedUrl}
            onDismiss={() => submit({ intent: "dismissSetup" }, { method: "post" })}
          />
        )}

        <MetricGrid>
          <Metric
            label="AI readiness"
            badge="Documented checks"
            value={readiness.score == null ? "–" : `${readiness.score} / 100`}
            help={
              data.readinessSince
                ? `${signed(data.readinessSince.delta)} since ${formatDate(data.readinessSince.since)}`
                : "Weighted share of passed checks"
            }
          />
          <Metric
            label="Mention rate"
            badge="Sampled"
            value={rateText(stats.mention)}
            help={
              stats.answers
                ? `${pluralize(stats.answers, "answer")} to ${pluralize(stats.prompts, "question")}, last 28 days${stats.mentionDelta != null ? ` · ${signed(stats.mentionDelta, " pts")}` : ""}`
                : "Track shopper questions in AI visibility"
            }
          />
          <Metric
            label="Cited as a source"
            badge="Sampled"
            value={stats.citation.value == null ? "–" : `${stats.citation.value}% of answers`}
            help={
              stats.answers
                ? `Answers that link to your store${stats.citationDelta != null ? ` · ${signed(stats.citationDelta, " pts")}` : ""}`
                : "Answers that link to your store"
            }
          />
          <Suspense fallback={<Metric label="AI-referred orders" badge="Shopify data" value="…" help="Reading orders" />}>
            <Await
              resolve={data.performance}
              errorElement={<Metric label="AI-referred orders" value="–" help="Couldn't read orders" />}
            >
              {(performance) => <ReferralMetric performance={performance} />}
            </Await>
          </Suspense>
        </MetricGrid>

        <s-grid gridTemplateColumns="repeat(auto-fit, minmax(320px, 1fr))" gap="base">
          <s-section heading="Do these next">
            <NextActions issues={data.issues} total={data.openIssues} />
          </s-section>
          <s-section heading="Readiness by area">
            <s-stack direction="block" gap="base">
              {readiness.areas.map((area) => (
                <Meter
                  key={area.key}
                  label={area.label}
                  value={area.score}
                  suffix={`${Math.round(area.weight * 100)}%`}
                />
              ))}
              <s-text color="subdued">
                Score and weight per area. GEO only counts checks it can verify;
                it doesn&apos;t predict rankings.
              </s-text>
            </s-stack>
          </s-section>
        </s-grid>

        <s-grid gridTemplateColumns="repeat(auto-fit, minmax(320px, 1fr))" gap="base">
          <s-section heading="Mention rate by week">
            <s-stack direction="block" gap="small">
              <TrendBars
                label="Mention rate by week, all AI tools"
                points={stats.trend.map((week) => ({
                  label: formatDate(week.start),
                  value: week.mention.value,
                  detail: week.mention.total
                    ? `${week.mention.total} answers`
                    : undefined,
                }))}
              />
              <s-text color="subdued">
                All AI tools combined. A grey tick means no answers that week.
                Movement after a fix is a correlation, not proof.
              </s-text>
            </s-stack>
          </s-section>
          <s-section heading="Mention rate by AI tool">
            {stats.byTool.length ? (
              <s-stack direction="block" gap="base">
                <RowBars
                  rows={stats.byTool.map((tool) => ({
                    label: tool.name,
                    value: tool.mention.value,
                    detail: `± ${tool.mention.margin} · ${tool.mention.total} answers`,
                  }))}
                />
                <s-link href="/app/visibility">Open AI visibility</s-link>
              </s-stack>
            ) : (
              <s-stack direction="block" gap="small">
                <s-paragraph>
                  {data.tracking.tools
                    ? "No answers in the last 28 days. Run a check from AI visibility."
                    : "Connect an AI tool to see how often it names your store."}
                </s-paragraph>
                <s-stack direction="inline" gap="small">
                  <s-button href={data.tracking.tools ? "/app/visibility" : "/app/settings/tools"}>
                    {data.tracking.tools ? "Open AI visibility" : "Connect AI tools"}
                  </s-button>
                </s-stack>
              </s-stack>
            )}
          </s-section>
        </s-grid>

        <s-grid gridTemplateColumns="repeat(auto-fit, minmax(320px, 1fr))" gap="base">
          <s-section heading="Ready for AI shopping channels?">
            <ChannelChecks checks={data.channels} />
          </s-section>
          <s-section heading="Recent changes">
            <RecentChanges changes={data.changes} />
          </s-section>
        </s-grid>
      </s-stack>
    </s-page>
  );
}

function ReferralMetric({ performance }) {
  if (!performance?.available)
    return (
      <Metric
        label="AI-referred orders"
        badge="Shopify data"
        value="Not available"
        help="Shopify order data isn't available for this store"
      />
    );
  const delta = performance.orders - performance.previousOrders;
  return (
    <Metric
      label="AI-referred orders"
      badge="Shopify data"
      value={formatNumber(performance.orders)}
      help={`${formatMoney(performance.sales, performance.currency) ?? "0"} sales, last 30 days${performance.previousOrders || performance.orders ? ` · ${signed(delta)}` : ""}`}
    />
  );
}

function NextActions({ issues, total }) {
  if (!issues.length)
    return <s-paragraph>No open issues. Re-run the audit after changes.</s-paragraph>;
  return (
    <s-stack direction="block" gap="small">
      <s-table variant="list">
        <s-table-header-row>
          <s-table-header listSlot="primary">Issue</s-table-header>
          <s-table-header listSlot="secondary">Affects</s-table-header>
          <s-table-header listSlot="inline">Impact</s-table-header>
          <s-table-header listSlot="labeled">Evidence</s-table-header>
        </s-table-header-row>
        <s-table-body>
          {issues.map((item) => (
            <s-table-row key={item.key}>
              <s-table-cell>
                <s-link href={`/app/fixes/${encodeURIComponent(item.key)}`}>
                  {item.title}
                </s-link>
              </s-table-cell>
              <s-table-cell>{item.affects}</s-table-cell>
              <s-table-cell>
                <ImpactBadge impact={item.impact} />
              </s-table-cell>
              <s-table-cell>
                <EvidenceBadge evidence={item.evidence} />
              </s-table-cell>
            </s-table-row>
          ))}
        </s-table-body>
      </s-table>
      <s-link href="/app/fixes">{`View all ${total}`}</s-link>
    </s-stack>
  );
}

const CHECK_BADGE = {
  ready: ["success", "Ready"],
  attention: ["warning", "Needs attention"],
  manual: ["neutral", "Check in Shopify"],
};

function ChannelChecks({ checks }) {
  return (
    <s-stack direction="block" gap="base">
      {checks.map((check) => {
        const [tone, label] = CHECK_BADGE[check.status];
        return (
          <s-stack key={check.key} direction="inline" gap="small" alignItems="start" justifyContent="space-between">
            <s-stack direction="block" gap="small-300">
              <s-stack direction="inline" gap="small" alignItems="center">
                <s-badge tone={tone}>{label}</s-badge>
                <s-text type="strong">{check.label}</s-text>
              </s-stack>
              <s-text color="subdued">{check.detail}</s-text>
            </s-stack>
            {check.href && (
              <s-button variant="tertiary" href={check.href}>
                {check.status === "attention" ? "Fix" : "Details"}
              </s-button>
            )}
          </s-stack>
        );
      })}
    </s-stack>
  );
}

function RecentChanges({ changes }) {
  if (!changes.length)
    return (
      <s-paragraph>
        Changes GEO publishes to your store appear here.
      </s-paragraph>
    );
  return (
    <s-stack direction="block" gap="base">
      {changes.map((change) => (
        <s-stack key={change.id} direction="block" gap="small-300">
          <s-stack direction="inline" gap="small" alignItems="center">
            <s-badge tone={change.status === "restored" ? "neutral" : "success"}>
              {change.status === "restored" ? "Restored" : "Published"}
            </s-badge>
            <s-text type="strong">{change.title}</s-text>
          </s-stack>
          <s-text color="subdued">
            {`${formatDateTime(change.createdAt)} · ${change.actor === "You" ? "by you" : change.actor}`}
          </s-text>
        </s-stack>
      ))}
    </s-stack>
  );
}

// ─── First run ───────────────────────────────────────────────────────────────

const HOW_IT_WORKS = [
  [
    "Sync and scan",
    "Import your products and read what AI crawlers see on your store today.",
  ],
  [
    "Fix list",
    "See what stops AI tools from reading your store and getting product details right.",
  ],
  [
    "Fix and track",
    "Apply fixes to robots.txt, llms.txt and product schema, then track how often AI names your store.",
  ],
];

function Welcome({ overview, syncRunning }) {
  const submit = useSubmit();
  const navigation = useNavigation();
  const starting = navigation.state !== "idle" && navigation.formMethod === "POST";

  return (
    <s-page heading="Welcome to GEO">
      <s-section>
        <s-stack direction="block" gap="small">
          <s-heading>Get your store ready for AI search</s-heading>
          <s-paragraph>
            Shoppers ask ChatGPT, Perplexity, Gemini and Claude what to buy. GEO
            checks whether those assistants can read your store and get your
            product details right, then fixes what stops them.
          </s-paragraph>
        </s-stack>
      </s-section>

      <s-section heading="Your store">
        <s-stack direction="block" gap="base">
          <s-stack direction="block" gap="small-400">
            <s-stack direction="inline" gap="small" alignItems="center">
              <s-text type="strong">{overview.name}</s-text>
              <s-badge tone="success" icon="check">
                Connected
              </s-badge>
            </s-stack>
            <s-text color="subdued">{overview.url}</s-text>
          </s-stack>

          <s-grid gridTemplateColumns="repeat(3, minmax(0, 1fr))" gap="base">
            <Stat label="Products" value={pluralize(overview.products, "product")} />
            <Stat
              label="Collections"
              value={pluralize(overview.collections, "collection")}
            />
            <Stat label="Live theme" value={overview.theme ?? "None"} />
          </s-grid>

          <s-divider />

          {syncRunning ? (
            <s-stack direction="inline" gap="base" alignItems="center">
              <s-button variant="primary" href="/app/optimize/sync">
                View sync progress
              </s-button>
              <s-text color="subdued">A sync is already running.</s-text>
            </s-stack>
          ) : (
            <s-stack direction="inline" gap="base" alignItems="center">
              <s-button
                variant="primary"
                icon="refresh"
                loading={starting || undefined}
                onClick={() => submit({}, { method: "post" })}
              >
                Sync store
              </s-button>
              <s-text color="subdued">
                Read-only. Nothing in your store changes until you approve the
                fixes.
              </s-text>
            </s-stack>
          )}
        </s-stack>
      </s-section>

      <s-section heading="How it works">
        <s-ordered-list>
          {HOW_IT_WORKS.map(([title, description]) => (
            <s-list-item key={title}>
              <s-text type="strong">{title}.</s-text> {description}
            </s-list-item>
          ))}
        </s-ordered-list>
      </s-section>

      <s-section slot="aside" heading="What GEO changes">
        <s-unordered-list>
          <s-list-item>
            robots.txt, so AI search crawlers can read your store
          </s-list-item>
          <s-list-item>llms.txt, a summary of your store written for AI</s-list-item>
          <s-list-item>
            Product schema, so AI gets correct prices, stock and policies
          </s-list-item>
        </s-unordered-list>
        <s-paragraph>
          <s-text color="subdued">
            You review every change before it goes live.
          </s-text>
        </s-paragraph>
      </s-section>
    </s-page>
  );
}

function Stat({ label, value }) {
  return (
    <s-box padding="base" background="subdued" borderRadius="base">
      <s-stack direction="block" gap="small-400">
        <s-text color="subdued">{label}</s-text>
        <s-text type="strong">{value}</s-text>
      </s-stack>
    </s-box>
  );
}

export const headers = (headersArgs) => boundary.headers(headersArgs);

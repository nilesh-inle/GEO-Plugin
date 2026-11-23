import { useLoaderData, useNavigation, useSubmit } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import {
  getLatestAudit,
  getLatestRun,
  startSync,
} from "../services/sync.server";
import { CrawlerTables } from "../components/CrawlerTables";
import { StepTracker } from "../components/StepTracker";
import { CountBadges, StatusBadge } from "../components/StatusBadge";
import { RUN_STATUS } from "../lib/constants";
import { formatDateTime, formatNumber } from "../lib/format";

export const loader = async ({ request }) => {
  const { session, redirect } = await authenticate.admin(request);
  const [audit, run] = await Promise.all([
    getLatestAudit(session.shop),
    getLatestRun(session.shop),
  ]);

  if (run?.status === RUN_STATUS.RUNNING) throw redirect("/app/optimize/sync");
  if (!audit) throw redirect("/app");
  return { audit };
};

export const action = async ({ request }) => {
  const { session, redirect } = await authenticate.admin(request);
  await startSync(session.shop);
  return redirect("/app/optimize/sync");
};

export default function AuditPage() {
  const { audit } = useLoaderData();
  const submit = useSubmit();
  const rescanning = useNavigation().state !== "idle";
  const { robots, llms, schema, totals } = audit;

  return (
    <s-page heading="Audit: what AI sees today">
      <s-button
        slot="primary-action"
        variant="primary"
        href="/app/optimize/update"
      >
        Review fixes
      </s-button>
      <s-button
        slot="secondary-actions"
        onClick={() => submit({}, { method: "post" })}
        loading={rescanning || undefined}
      >
        Re-scan
      </s-button>

      <s-stack direction="block" gap="base">
        <s-stack
          direction="inline"
          gap="base"
          alignItems="center"
          justifyContent="space-between"
        >
          <StepTracker current={1} />
          <s-stack direction="inline" gap="small" alignItems="center">
            <s-text color="subdued">
              Scanned {formatDateTime(audit.createdAt)}
            </s-text>
            <CountBadges issues={totals.issues} warnings={totals.warnings} />
          </s-stack>
        </s-stack>

        {audit.passwordProtected && (
          <s-banner tone="critical" heading="Your store is password protected">
            AI crawlers see only the password page, so nothing else in this
            audit can help until the store is open.
            <s-button
              slot="secondary-actions"
              href="shopify://admin/online_store/preferences"
              target="_top"
            >
              Open preferences
            </s-button>
          </s-banner>
        )}

        <s-section heading="robots.txt: can AI crawl your store?">
          <s-stack direction="block" gap="base">
            <SectionStatus
              issues={robots.issues}
              warnings={robots.warnings}
              status={robots.status}
            />
            {robots.status === "unknown" ? (
              <s-text color="subdued">{robots.error}</s-text>
            ) : (
              <CrawlerTables crawlers={robots.crawlers} />
            )}
          </s-stack>
        </s-section>

        <s-section heading="llms.txt: does AI get a summary of your store?">
          <s-stack direction="block" gap="small">
            <SectionStatus
              issues={llms.issues}
              warnings={llms.warnings}
              status={llms.status}
            />
            {llms.findings.map((finding) => (
              <s-stack
                key={finding.text}
                direction="inline"
                gap="small"
                alignItems="center"
              >
                <s-icon
                  type={
                    finding.tone === "success"
                      ? "check-circle"
                      : "alert-triangle"
                  }
                  tone={finding.tone === "success" ? "success" : finding.tone}
                />
                <s-text>{finding.text}</s-text>
              </s-stack>
            ))}
          </s-stack>
        </s-section>

        <s-section heading="Product schema: is product info complete and correct?">
          <s-stack direction="block" gap="base">
            <SectionStatus
              issues={schema.issues}
              warnings={schema.warnings}
              status={schema.status}
            />
            {schema.note ? (
              <s-text color="subdued">{schema.note}</s-text>
            ) : (
              <>
                <s-table>
                  <s-table-header-row>
                    <s-table-header listSlot="primary">Field</s-table-header>
                    <s-table-header>Products</s-table-header>
                    <s-table-header>Status</s-table-header>
                  </s-table-header-row>
                  <s-table-body>
                    {schema.fields.map((field) => (
                      <s-table-row key={field.key}>
                        <s-table-cell>{field.label}</s-table-cell>
                        <s-table-cell>
                          {field.key === "organization"
                            ? "Home page"
                            : `${formatNumber(field.count)} of ${formatNumber(field.total)}`}
                        </s-table-cell>
                        <s-table-cell>
                          <StatusBadge status={field.status}>
                            {field.detail}
                          </StatusBadge>
                        </s-table-cell>
                      </s-table-row>
                    ))}
                  </s-table-body>
                </s-table>
                <SchemaNotes schema={schema} />
              </>
            )}
          </s-stack>
        </s-section>

        <s-stack direction="inline" justifyContent="end">
          <s-button variant="primary" href="/app/optimize/update">
            Review fixes
          </s-button>
        </s-stack>
      </s-stack>
    </s-page>
  );
}

function SectionStatus({ issues, warnings, status }) {
  if (status === "unknown")
    return <s-badge tone="neutral">Not checked</s-badge>;
  return <CountBadges issues={issues} warnings={warnings} />;
}

function SchemaNotes({ schema }) {
  const notes = [];
  if (schema.total > schema.scanned) {
    notes.push(
      `Checked the ${formatNumber(schema.scanned)} most recently updated of ${formatNumber(schema.total)} products.`,
    );
  }
  if (schema.invalidPages)
    notes.push(
      `${formatNumber(schema.invalidPages)} pages have JSON-LD that isn't valid JSON.`,
    );
  if (schema.duplicatePages) {
    notes.push(
      `Your theme also outputs Product schema on ${formatNumber(schema.duplicatePages)} pages, so AI sees two copies.`,
    );
  }
  if (schema.failedPages)
    notes.push(
      `${formatNumber(schema.failedPages)} product pages couldn't be loaded.`,
    );
  if (!notes.length) return null;

  return (
    <s-unordered-list>
      {notes.map((note) => (
        <s-list-item key={note}>
          <s-text color="subdued">{note}</s-text>
        </s-list-item>
      ))}
    </s-unordered-list>
  );
}

export const headers = (headersArgs) => boundary.headers(headersArgs);

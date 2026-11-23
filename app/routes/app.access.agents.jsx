import { useEffect, useRef } from "react";
import { useFetcher, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { readBody, requireStore } from "../services/guard.server";
import { runAgentChecks, testAsAgent } from "../services/access.server";
import { AccessNav } from "../components/HubNav";
import { Metric, MetricGrid } from "../components/ui";
import { formatDateTime, formatMoney } from "../lib/format";

export const loader = async ({ request }) => {
  const { store } = await requireStore(request);
  return {
    agents: store.accessState.agents ?? null,
    storeUrl: store.url,
    currency: store.currency,
  };
};

export const action = async ({ request }) => {
  const { shop, store } = await requireStore(request);
  const body = await readBody(request);
  if (body.intent === "run") return { agents: await runAgentChecks(shop, store) };
  if (body.intent === "test") {
    const query = String(body.query || "").trim().slice(0, 200);
    if (!query) return { testError: "Type what a shopper would ask." };
    try {
      return { test: { query, ...(await testAsAgent(store, query)) } };
    } catch (error) {
      return { testError: `The store's Catalog MCP didn't answer: ${error.message}` };
    }
  }
  return null;
};

const STATUS = {
  pass: ["success", "Pass"],
  attention: ["warning", "Attention"],
  info: ["info", "Not found"],
  manual: ["neutral", "Check in Shopify"],
};

export default function AgentReadiness() {
  const data = useLoaderData();
  const run = useFetcher();
  const test = useFetcher();
  const queryRef = useRef(null);
  const agents = run.data?.agents ?? data.agents;
  const running = run.state !== "idle";

  // First visit: run the checks once.
  const started = useRef(false);
  useEffect(() => {
    if (data.agents || started.current) return;
    started.current = true;
    run.submit({ intent: "run" }, { method: "post" });
  }, [data.agents, run]);

  const passed = agents?.checks.filter((check) => check.status === "pass").length ?? 0;
  const attention = agents?.checks.filter((check) => check.status === "attention").length ?? 0;
  const manual = agents?.checks.filter((check) => check.status === "manual").length ?? 0;

  return (
    <s-page heading="AI access" inlineSize="large">
      <s-button
        slot="primary-action"
        variant="primary"
        loading={running || undefined}
        onClick={() => run.submit({ intent: "run" }, { method: "post" })}
      >
        Run checks again
      </s-button>

      <s-stack direction="block" gap="base">
        <AccessNav current="agents" />
        <s-text color="subdued">
          Can a shopping agent find, understand and buy from your store?
        </s-text>

        {!agents ? (
          <s-section>
            <s-stack direction="inline" gap="small" alignItems="center">
              <s-spinner accessibilityLabel="Running checks" size="base" />
              <s-text>Running agent-readiness checks…</s-text>
            </s-stack>
          </s-section>
        ) : (
          <>
            <MetricGrid>
              <Metric
                label="Agent-readiness checks"
                value={`${passed} of ${agents.checks.length}`}
                help={`${attention} need attention · ${manual} to check in Shopify`}
              />
              <Metric
                label="Products with complete agent fields"
                value={agents.products ? `${Math.round((agents.complete / agents.products) * 100)}%` : "–"}
                help={`${agents.complete.toLocaleString("en-US")} of ${agents.products.toLocaleString("en-US")} have category, description and GTIN`}
              />
              <Metric
                label="Catalog MCP"
                value={agents.mcp.ok ? "Responding" : "No answer"}
                help={agents.mcp.ok ? `${agents.mcp.tools.slice(0, 2).join(", ")}${agents.mcp.tools.length > 2 ? "…" : ""}` : "/api/mcp on your storefront"}
              />
              <Metric
                label="UCP discovery"
                value={agents.ucp.ok ? "Responding" : "Not served"}
                help={`/.well-known/ucp · HTTP ${agents.ucp.status || "error"}`}
              />
            </MetricGrid>

            <s-section heading="Agent-readiness checks">
              <s-table>
                <s-table-header-row>
                  <s-table-header listSlot="primary">Check</s-table-header>
                  <s-table-header>Status</s-table-header>
                  <s-table-header>Detail</s-table-header>
                  <s-table-header>Action</s-table-header>
                </s-table-header-row>
                <s-table-body>
                  {agents.checks.map((check) => {
                    const [tone, label] = STATUS[check.status];
                    return (
                      <s-table-row key={check.key}>
                        <s-table-cell>{check.label}</s-table-cell>
                        <s-table-cell>
                          <s-badge tone={tone}>{label}</s-badge>
                        </s-table-cell>
                        <s-table-cell>{check.detail}</s-table-cell>
                        <s-table-cell>
                          {check.href ? (
                            <s-button variant="tertiary" href={check.href}>
                              {check.status === "attention" ? "Fix" : "Open"}
                            </s-button>
                          ) : null}
                        </s-table-cell>
                      </s-table-row>
                    );
                  })}
                </s-table-body>
              </s-table>
              <s-box paddingBlockStart="small">
                <s-text color="subdued">{`Checked ${formatDateTime(agents.checkedAt)}`}</s-text>
              </s-box>
            </s-section>
          </>
        )}

        <s-section heading="Test as an agent">
          <s-stack direction="block" gap="base">
            <s-paragraph>
              Ask your store&apos;s public Catalog MCP the way a shopping agent
              would, and see exactly what comes back. No AI answers are used.
            </s-paragraph>
            <s-text-field
              ref={queryRef}
              label="Shopper request"
              placeholder="waterproof hiking boots for wide feet under $200"
              error={test.data?.testError}
            />
            <s-stack direction="inline">
              <s-button
                loading={test.state !== "idle" || undefined}
                onClick={() =>
                  test.submit(
                    { intent: "test", query: queryRef.current?.value ?? "" },
                    { method: "post" },
                  )
                }
              >
                Run test
              </s-button>
            </s-stack>
            {test.data?.test && <AgentResults test={test.data.test} currency={data.currency} />}
          </s-stack>
        </s-section>

        <s-section heading="What agents read">
          <s-unordered-list>
            <s-list-item>
              Shopify Catalog: product records, variants and policies
            </s-list-item>
            <s-list-item>
              agents.md and UCP discovery: how to search your store and check out
            </s-list-item>
            <s-list-item>
              Your Catalog MCP at {`${data.storeUrl}/api/mcp`}: live search and
              product lookups
            </s-list-item>
          </s-unordered-list>
        </s-section>
      </s-stack>
    </s-page>
  );
}

function AgentResults({ test, currency }) {
  if (!test.products.length)
    return (
      <s-banner tone="warning" heading={`No products came back for “${test.query}”`}>
        A shopping agent asking this would find nothing in your store. Check
        that product titles and descriptions use the words shoppers use.
      </s-banner>
    );
  return (
    <s-stack direction="block" gap="small">
      <s-ordered-list>
        {test.products.map((product, index) => (
          <s-list-item key={product.id ?? index}>
            <s-stack direction="block" gap="small-300">
              <s-stack direction="inline" gap="small" alignItems="center">
                {product.url ? (
                  <s-link href={product.url} target="_blank">
                    {product.title}
                  </s-link>
                ) : (
                  <s-text type="strong">{product.title}</s-text>
                )}
                {product.gaps.length ? (
                  product.gaps.map((gap) => (
                    <s-badge key={gap} tone="warning">
                      {gap}
                    </s-badge>
                  ))
                ) : (
                  <s-badge tone="success">Complete</s-badge>
                )}
              </s-stack>
              <s-text color="subdued">
                {[
                  product.price != null &&
                    (formatMoney(Number(product.price), product.currency || currency) ?? product.price),
                  product.available === true && "in stock",
                  product.available === false && "out of stock",
                  product.variants != null && `${product.variants} variants`,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </s-text>
            </s-stack>
          </s-list-item>
        ))}
      </s-ordered-list>
      <s-text color="subdued">
        {`${test.products.length} results in ${(test.ms / 1000).toFixed(1)} s. Agents still apply their own ranking.`}
      </s-text>
    </s-stack>
  );
}

export const headers = (headersArgs) => boundary.headers(headersArgs);

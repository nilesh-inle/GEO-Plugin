import { useState } from "react";
import { useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { requireStore } from "../services/guard.server";
import { listContent } from "../services/content.server";
import { getPromptStats } from "../services/visibility.server";
import { EvidenceBadge, FilterTabs, Metric, MetricGrid } from "../components/ui";
import { CONTENT_PARTS } from "../lib/contentScore";
import { formatDate } from "../lib/format";

export const loader = async ({ request }) => {
  const { admin, shop } = await requireStore(request);
  const [content, prompts] = await Promise.all([listContent(admin), getPromptStats(shop)]);
  return {
    content,
    // Tracked questions where AI rarely names the store: candidates for a page you own.
    gaps: prompts
      .filter((prompt) => prompt.answers > 0 && (prompt.mention.value ?? 0) < 50)
      .sort((a, b) => (a.mention.value ?? 0) - (b.mention.value ?? 0))
      .slice(0, 10),
  };
};

const scoreTone = (score) => (score >= 75 ? "success" : score >= 50 ? "warning" : "critical");
const partScore = (item, key) => item.parts.find((part) => part.key === key)?.score ?? 0;

export default function Content() {
  const { content, gaps } = useLoaderData();
  const [tab, setTab] = useState("posts");
  const items = content.available ? content.items : [];
  const average = items.length
    ? Math.round(items.reduce((sum, item) => sum + item.score, 0) / items.length)
    : null;

  return (
    <s-page heading="Content" inlineSize="large">
      <s-stack direction="block" gap="base">
        <s-text color="subdued">
          Blog posts and pages scored for how well AI can extract, trust and
          quote them.
        </s-text>

        {!content.available ? (
          <s-banner tone="warning" heading="Posts and pages can't be read yet">
            {content.message}
          </s-banner>
        ) : (
          <MetricGrid>
            <Metric
              label="Average GEO/AEO score"
              value={average == null ? "–" : String(average)}
              help={`${items.length} posts and pages`}
            />
            <Metric
              label="Answer-ready"
              value={items.filter((item) => item.score >= 75).length}
              help="Score 75 or higher"
            />
            <Metric
              label="Need a direct answer"
              value={items.filter((item) => partScore(item, "answer") < 50).length}
              help="No short opening that answers the title"
            />
            <Metric
              label="Questions without a page"
              value={gaps.length}
              help="Tracked questions where AI rarely names you"
            />
          </MetricGrid>
        )}

        <s-section padding="none" accessibilityLabel="Content">
          <s-box padding="base">
            <FilterTabs
              tabs={[
                { key: "posts", label: "Posts and pages", count: items.length },
                { key: "questions", label: "Questions to answer", count: gaps.length },
              ]}
              current={tab}
              onSelect={setTab}
            />
          </s-box>
          {tab === "posts" ? (
            items.length ? (
              <s-table>
                <s-table-header-row>
                  <s-table-header listSlot="primary">Title</s-table-header>
                  <s-table-header>Type</s-table-header>
                  <s-table-header>GEO/AEO score</s-table-header>
                  <s-table-header>Answer-ready</s-table-header>
                  <s-table-header>Credibility</s-table-header>
                  <s-table-header>Updated</s-table-header>
                  <s-table-header>Action</s-table-header>
                </s-table-header-row>
                <s-table-body>
                  {[...items]
                    .sort((a, b) => a.score - b.score)
                    .map((item) => (
                      <s-table-row key={item.id}>
                        <s-table-cell>
                          <s-stack direction="block" gap="small-400">
                            <s-text>{item.title}</s-text>
                            <s-text color="subdued">
                              {`${item.path}${item.published ? "" : " · not published"}`}
                            </s-text>
                          </s-stack>
                        </s-table-cell>
                        <s-table-cell>{item.type}</s-table-cell>
                        <s-table-cell>
                          <s-badge tone={scoreTone(item.score)}>{String(item.score)}</s-badge>
                        </s-table-cell>
                        <s-table-cell>
                          <Level value={partScore(item, "answer")} />
                        </s-table-cell>
                        <s-table-cell>
                          <Level value={partScore(item, "credibility")} />
                        </s-table-cell>
                        <s-table-cell>{formatDate(item.updatedAt)}</s-table-cell>
                        <s-table-cell>
                          <s-button
                            variant="secondary"
                            href={`/app/content/analyze?id=${encodeURIComponent(item.id)}`}
                          >
                            Analyze
                          </s-button>
                        </s-table-cell>
                      </s-table-row>
                    ))}
                </s-table-body>
              </s-table>
            ) : (
              <s-box padding="large">
                <s-text color="subdued">
                  {content.available ? "No blog posts or pages yet." : "Content couldn't be loaded."}
                </s-text>
              </s-box>
            )
          ) : gaps.length ? (
            <s-table>
              <s-table-header-row>
                <s-table-header listSlot="primary">Tracked question</s-table-header>
                <s-table-header>Named in</s-table-header>
                <s-table-header>Evidence</s-table-header>
                <s-table-header>Action</s-table-header>
              </s-table-header-row>
              <s-table-body>
                {gaps.map((prompt) => (
                  <s-table-row key={prompt.id}>
                    <s-table-cell>{prompt.text}</s-table-cell>
                    <s-table-cell>
                      {`${prompt.mention.value ?? 0}% of ${prompt.answers} answers`}
                    </s-table-cell>
                    <s-table-cell>
                      <EvidenceBadge evidence="hypothesis" />
                    </s-table-cell>
                    <s-table-cell>
                      <s-button variant="secondary" href={`/app/visibility/citations/${prompt.id}`}>
                        See answers
                      </s-button>
                    </s-table-cell>
                  </s-table-row>
                ))}
              </s-table-body>
            </s-table>
          ) : (
            <s-box padding="large">
              <s-text color="subdued">
                Questions appear here when AI tools rarely name you for a
                question you track.
              </s-text>
            </s-box>
          )}
        </s-section>

        <s-section heading="How the GEO/AEO score works">
          <s-stack direction="block" gap="small">
            <s-paragraph>
              A checklist of what GEO can verify on the page, 0–100. It is not a
              prediction of rankings.
            </s-paragraph>
            <s-unordered-list>
              {CONTENT_PARTS.map((part) => (
                <s-list-item key={part.key}>
                  {`${part.label} · ${Math.round(part.weight * 100)}%`}
                </s-list-item>
              ))}
            </s-unordered-list>
            <s-stack direction="inline" gap="small" alignItems="center">
              <EvidenceBadge evidence="research" />
              <s-text color="subdued">
                Statistics, cited sources and quotes raised visibility in a lab
                study. The rest is good practice; Google says no special AI
                formatting is required.
              </s-text>
            </s-stack>
          </s-stack>
        </s-section>
      </s-stack>
    </s-page>
  );
}

function Level({ value }) {
  const [tone, label] = value >= 75 ? ["success", "High"] : value >= 45 ? ["warning", "Partly"] : ["critical", "Low"];
  return <s-badge tone={tone}>{label}</s-badge>;
}

export const headers = (headersArgs) => boundary.headers(headersArgs);

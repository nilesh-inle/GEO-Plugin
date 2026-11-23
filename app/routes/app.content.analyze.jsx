import { useFetcher, useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { readBody, requireStore } from "../services/guard.server";
import { getContentItem, suggestContent } from "../services/content.server";
import { CodeBlock } from "../components/CodeBlock";
import { EvidenceBadge, Meter } from "../components/ui";
import { CONTENT_PARTS, readContent } from "../lib/contentScore";
import { formatDate } from "../lib/format";

export const loader = async ({ request }) => {
  const { admin, redirect } = await requireStore(request);
  const id = new URL(request.url).searchParams.get("id");
  if (!id) throw redirect("/app/content");
  const item = await getContentItem(admin, id).catch(() => null);
  if (!item) throw redirect("/app/content");
  const page = readContent(item.html);
  return {
    item: {
      id: item.id,
      kind: item.kind,
      title: item.title,
      type: item.type,
      path: item.path,
      author: item.author,
      updatedAt: item.updatedAt,
      opening: page.firstParagraph,
    },
    analysis: item.analysis,
  };
};

export const action = async ({ request }) => {
  const { admin, shop, store } = await requireStore(request);
  const body = await readBody(request);
  try {
    return { ok: true, suggestions: await suggestContent(admin, shop, String(body.id), store) };
  } catch (error) {
    return { ok: false, error: error.message };
  }
};

export default function Analyzer() {
  const { item, analysis } = useLoaderData();
  const shopify = useAppBridge();
  const suggest = useFetcher();
  const suggestions = suggest.data?.suggestions;
  const adminUrl =
    item.kind === "page"
      ? `shopify://admin/pages/${item.id.split("/").pop()}`
      : `shopify://admin/articles/${item.id.split("/").pop()}`;

  const copy = async (text) => {
    try {
      await navigator.clipboard.writeText(text);
      shopify.toast.show("Copied");
    } catch {
      shopify.toast.show("Couldn't copy. Select the text instead.", { isError: true });
    }
  };

  return (
    <s-page heading={item.title} inlineSize="large">
      <s-link slot="breadcrumb-actions" href="/app/content">
        Content
      </s-link>
      <s-button
        slot="primary-action"
        variant="primary"
        loading={suggest.state !== "idle" || undefined}
        onClick={() => suggest.submit({ id: item.id }, { method: "post" })}
      >
        {suggestions ? "Write new suggestions" : "Write suggestions"}
      </s-button>
      <s-button slot="secondary-actions" href={adminUrl} target="_blank">
        Open in Shopify
      </s-button>

      <s-stack direction="block" gap="base">
        <s-stack direction="inline" gap="small" alignItems="center">
          <s-badge tone="neutral">{item.type}</s-badge>
          <s-text color="subdued">
            {`${item.path} · updated ${formatDate(item.updatedAt)}${item.author ? ` · by ${item.author}` : ""} · ${analysis.words} words`}
          </s-text>
        </s-stack>

        {suggest.data?.error && (
          <s-banner tone="critical" heading="Suggestions weren't written">
            {suggest.data.error}
          </s-banner>
        )}

        <s-grid gridTemplateColumns="repeat(auto-fit, minmax(320px, 1fr))" gap="base">
          <s-section heading={`GEO/AEO score · ${analysis.score}`}>
            <s-stack direction="block" gap="base">
              {analysis.parts.map((part) => (
                <Meter
                  key={part.key}
                  label={part.label}
                  value={part.score}
                  suffix={`${Math.round(part.weight * 100)}%`}
                />
              ))}
              <s-text color="subdued">
                Scores what GEO can check on the page. It doesn&apos;t predict rankings.
              </s-text>
            </s-stack>
          </s-section>
          <s-section heading="What GEO checked">
            <s-stack direction="block" gap="small">
              {CONTENT_PARTS.map((part) => (
                <s-stack key={part.key} direction="block" gap="small-300">
                  <s-text type="strong">{part.label}</s-text>
                  {analysis.findings
                    .filter((finding) => finding.part === part.key)
                    .map((finding) => (
                      <s-stack key={finding.text} direction="inline" gap="small" alignItems="center">
                        <s-badge tone={finding.passed ? "success" : "warning"}>
                          {finding.passed ? "Pass" : "Add"}
                        </s-badge>
                        <s-text>{finding.text}</s-text>
                      </s-stack>
                    ))}
                </s-stack>
              ))}
            </s-stack>
          </s-section>
        </s-grid>

        <s-section heading="Answer snippet">
          <s-stack direction="block" gap="base">
            <s-stack direction="inline" gap="small" alignItems="center">
              <EvidenceBadge evidence="hypothesis" />
              <s-text color="subdued">
                A direct answer in the first lines is easy for people and AI to quote.
              </s-text>
            </s-stack>
            <s-stack direction="block" gap="small-300">
              <s-text color="subdued">Current opening</s-text>
              <CodeBlock lines={[{ text: item.opening || "(no opening paragraph)", kind: suggestions?.opening ? "removed" : "note" }]} />
            </s-stack>
            {suggestions?.opening && (
              <s-stack direction="block" gap="small-300">
                <s-text color="subdued">{`Suggested · ${suggestions.opening.split(/\s+/).length} words`}</s-text>
                <CodeBlock lines={[{ text: suggestions.opening, kind: "added" }]} />
                <s-stack direction="inline">
                  <s-button onClick={() => copy(suggestions.opening)}>Copy opening</s-button>
                </s-stack>
              </s-stack>
            )}
          </s-stack>
        </s-section>

        {suggestions && (
          <>
            <s-section heading="Question headings">
              {suggestions.questionHeadings.length ? (
                <CodeBlock
                  lines={suggestions.questionHeadings.flatMap((row) => [
                    { text: row.from, kind: "removed" },
                    { text: row.to, kind: "added" },
                  ])}
                />
              ) : (
                <s-text color="subdued">No headings to rephrase.</s-text>
              )}
            </s-section>
            <s-section heading="FAQs this page already answers">
              {suggestions.faqs.length ? (
                <s-stack direction="block" gap="small">
                  {suggestions.faqs.map((faq) => (
                    <s-stack key={faq.question} direction="block" gap="small-400">
                      <s-text type="strong">{faq.question}</s-text>
                      <s-text>{faq.answer}</s-text>
                    </s-stack>
                  ))}
                  <s-stack direction="inline">
                    <s-button
                      onClick={() =>
                        copy(suggestions.faqs.map((faq) => `${faq.question}\n${faq.answer}`).join("\n\n"))
                      }
                    >
                      Copy FAQs
                    </s-button>
                  </s-stack>
                </s-stack>
              ) : (
                <s-text color="subdued">No FAQs suggested.</s-text>
              )}
            </s-section>
          </>
        )}

        <s-section heading="Guardrails">
          <s-unordered-list>
            <s-list-item>
              Suggestions only use facts already on the page. Check every line
              before you use it.
            </s-list-item>
            <s-list-item>
              Nothing is published by GEO: copy what you want into the post in
              Shopify.
            </s-list-item>
          </s-unordered-list>
        </s-section>
      </s-stack>
    </s-page>
  );
}

export const headers = (headersArgs) => boundary.headers(headersArgs);

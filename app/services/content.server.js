/**
 * Content: blog posts and pages from Shopify (read_content), scored for how
 * well AI can extract and quote them, with AI-written suggestions.
 */
import { gql } from "./admin.server";
import { runWithAiTool } from "./tracking.server";
import { buildContentRequest, scoreContent } from "../lib/contentScore";

const LIST_QUERY = `#graphql
  query GeoContentList {
    articles(first: 50, sortKey: UPDATED_AT, reverse: true) {
      nodes {
        id
        title
        handle
        body
        updatedAt
        isPublished
        author {
          name
        }
        blog {
          handle
          title
        }
      }
    }
    pages(first: 50, sortKey: UPDATED_AT, reverse: true) {
      nodes {
        id
        title
        handle
        body
        updatedAt
        isPublished
      }
    }
  }`;

function articleView(node) {
  return {
    id: node.id,
    kind: "article",
    type: node.blog?.title ? `Blog · ${node.blog.title}` : "Blog post",
    title: node.title,
    path: `/blogs/${node.blog?.handle ?? "news"}/${node.handle}`,
    html: node.body ?? "",
    author: node.author?.name ?? null,
    updatedAt: node.updatedAt,
    published: node.isPublished,
  };
}

function pageView(node) {
  return {
    id: node.id,
    kind: "page",
    type: "Page",
    title: node.title,
    path: `/pages/${node.handle}`,
    html: node.body ?? "",
    author: null,
    updatedAt: node.updatedAt,
    published: node.isPublished,
  };
}

function scored(item) {
  const result = scoreContent(item);
  const rest = { ...item };
  delete rest.html;
  return {
    ...rest,
    score: result.score,
    parts: result.parts,
    words: result.words,
  };
}

/** Recent posts and pages with their scores, or the reason they can't be read. */
export async function listContent(admin) {
  try {
    const data = await gql(admin, LIST_QUERY);
    const items = [
      ...data.articles.nodes.map(articleView),
      ...data.pages.nodes.map(pageView),
    ];
    return { available: true, items: items.map(scored) };
  } catch (error) {
    return {
      available: false,
      message: /access|scope|read_content/i.test(error.message)
        ? "GEO needs permission to read blog posts and pages. Reopen the app and accept the updated permissions."
        : error.message,
    };
  }
}

/** One post or page with its full score and findings. */
export async function getContentItem(admin, id) {
  const isPage = String(id).includes("/Page/");
  const data = await gql(
    admin,
    isPage
      ? `#graphql
        query GeoContentPage($id: ID!) {
          page(id: $id) {
            id
            title
            handle
            body
            updatedAt
            isPublished
          }
        }`
      : `#graphql
        query GeoContentArticle($id: ID!) {
          article(id: $id) {
            id
            title
            handle
            body
            updatedAt
            isPublished
            author {
              name
            }
            blog {
              handle
              title
            }
          }
        }`,
    { id },
  );
  const node = isPage ? data.page : data.article;
  if (!node) return null;
  const item = isPage ? pageView(node) : articleView(node);
  return { ...item, analysis: scoreContent(item) };
}

/** Answer-first opening, question headings and FAQs written by the merchant's AI tool. */
export async function suggestContent(admin, shop, id, store) {
  const item = await getContentItem(admin, id);
  if (!item) throw new Error("That post or page no longer exists.");
  const { result } = await runWithAiTool(
    shop,
    (adapter, tool) =>
      adapter.generateJson(
        tool.apiKey,
        tool.model,
        buildContentRequest({ title: item.title, html: item.html, storeName: store?.name }),
      ),
    { label: "Writing content suggestions" },
  );
  return {
    opening: String(result?.opening ?? "").trim().slice(0, 800),
    questionHeadings: (result?.questionHeadings ?? [])
      .filter((row) => row?.from && row?.to)
      .slice(0, 4)
      .map((row) => ({ from: String(row.from).slice(0, 200), to: String(row.to).slice(0, 200) })),
    faqs: (result?.faqs ?? [])
      .filter((row) => row?.question && row?.answer)
      .slice(0, 5)
      .map((row) => ({ question: String(row.question).slice(0, 200), answer: String(row.answer).slice(0, 500) })),
  };
}

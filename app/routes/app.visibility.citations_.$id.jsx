import { useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { requireStore } from "../services/guard.server";
import { getPromptDetail } from "../services/citations.server";
import { PromptDetails } from "../components/PromptDetails";
import { parseEngines, parseRange, periodText, viewQuery } from "../lib/citationView";
import "../styles/citations.css";

/**
 * One prompt's citation details. Loaded as JSON by the side panel on the AI
 * visibility page, and shown as a page when opened directly. A prompt that
 * doesn't exist returns `detail: null` so the panel can say so.
 */
export const loader = async ({ request, params }) => {
  const { shop } = await requireStore(request);
  const url = new URL(request.url);
  const range = parseRange(url.searchParams);
  const engines = parseEngines(url.searchParams.get("tools"));
  const detail = await getPromptDetail(shop, params.id, { range, engines });
  return { detail, range, engines };
};

export default function PromptCitations() {
  const { detail, range, engines } = useLoaderData();
  const back = `/app/visibility?${viewQuery({ range, engines })}`;

  return (
    <s-page heading={detail?.prompt.text ?? "Prompt details"} inlineSize="large">
      <s-link slot="breadcrumb-actions" href={back}>
        AI visibility
      </s-link>
      {detail ? (
        <div className="geo-ui overflow-hidden rounded-xl border border-gray-200 bg-white">
          <PromptDetails detail={detail} engines={engines} period={periodText(range)} />
        </div>
      ) : (
        <s-section heading="Prompt not found">
          <s-paragraph>This prompt isn&apos;t tracked any more.</s-paragraph>
          <s-button href={back}>Back to AI visibility</s-button>
        </s-section>
      )}
    </s-page>
  );
}

export const headers = (headersArgs) => boundary.headers(headersArgs);

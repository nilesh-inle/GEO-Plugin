import { useEffect, useRef } from "react";
import { useFetcher, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { readBody, requireStore } from "../services/guard.server";
import { addCompetitor, removeCompetitor } from "../services/citations.server";
import { patchStoreJson } from "../services/store.server";
import {
  getTrackDomains,
  getTrackOverview,
  saveTrackDomains,
  saveTrackSettings,
} from "../services/tracking.server";
import { SettingsNav } from "../components/HubNav";
import { TRACK } from "../lib/constants";
import { formatDateTime } from "../lib/format";
import {
  MAX_BRAND_TERMS,
  MAX_COMPETITORS,
  parseBrandTerms,
  parseStoreName,
} from "../lib/settings";

const COMPETITOR_INTENTS = { ADD: "addCompetitor", REMOVE: "removeCompetitor" };

export const loader = async ({ request }) => {
  const { shop, store } = await requireStore(request);
  const [overview, domains] = await Promise.all([
    getTrackOverview(shop),
    getTrackDomains(shop),
  ]);
  return {
    overview,
    domains,
    shopifyName: store.name,
    storeName: store.settings.storeName ?? "",
    terms: Array.isArray(store.settings.brandTerms) ? store.settings.brandTerms : [],
    competitors: store.competitors,
  };
};

export const action = async ({ request }) => {
  const { shop } = await requireStore(request);
  const body = await readBody(request);
  try {
    if (body.intent === COMPETITOR_INTENTS.ADD) {
      await addCompetitor(shop, { name: body.name, website: body.website });
      return { ok: true, intent: body.intent };
    }
    if (body.intent === COMPETITOR_INTENTS.REMOVE) {
      await removeCompetitor(shop, body.name);
      return { ok: true, intent: body.intent };
    }

    const storeName = parseStoreName(body.storeName);
    await saveTrackSettings(shop, { answers: body.answers });
    // Names first: saving domains re-checks every saved answer.
    await patchStoreJson(shop, "settings", {
      storeName,
      brandTerms: parseBrandTerms(body.terms),
    });
    const domains = await saveTrackDomains(shop, body.domains ?? "");
    return { ok: true, rescored: domains.rescored };
  } catch (error) {
    return { ok: false, error: error.message };
  }
};

/**
 * Competitors save as soon as they're added or removed, so this section sits
 * outside the save-bar form.
 */
function Competitors({ competitors }) {
  const fetcher = useFetcher();
  const formRef = useRef(null);
  const pending = fetcher.state !== "idle" ? fetcher.formData?.get("intent") : null;
  const full = competitors.length >= MAX_COMPETITORS;

  // Clear the fields once a competitor is added.
  useEffect(() => {
    if (fetcher.state !== "idle" || fetcher.data?.intent !== COMPETITOR_INTENTS.ADD) return;
    for (const field of formRef.current?.querySelectorAll("s-text-field") ?? []) field.value = "";
  }, [fetcher.state, fetcher.data]);

  const add = () => {
    const form = formRef.current;
    fetcher.submit(
      {
        intent: COMPETITOR_INTENTS.ADD,
        name: form.querySelector("[name=competitorName]")?.value ?? "",
        website: form.querySelector("[name=competitorWebsite]")?.value ?? "",
      },
      { method: "post" },
    );
  };

  return (
    <s-section heading="Competitors">
      <s-stack direction="block" gap="base">
        <s-paragraph color="subdued">
          AI visibility counts the answers that name these competitors. With a website, links to it
          count as their citations too.
        </s-paragraph>

        {fetcher.data?.error && (
          <s-banner tone="critical" heading="Competitor wasn't saved">
            {fetcher.data.error}
          </s-banner>
        )}

        {competitors.length ? (
          <s-stack direction="block" gap="small">
            {competitors.map((competitor) => (
              <s-grid
                key={competitor.name}
                gridTemplateColumns="1fr auto"
                gap="base"
                alignItems="center"
              >
                <s-stack direction="block">
                  <s-text type="strong">{competitor.name}</s-text>
                  <s-text color="subdued">
                    {competitor.domain ?? "No website: only mentions count"}
                  </s-text>
                </s-stack>
                <s-button
                  variant="tertiary"
                  tone="critical"
                  icon="delete"
                  accessibilityLabel={`Remove ${competitor.name}`}
                  disabled={Boolean(pending)}
                  onClick={() =>
                    fetcher.submit(
                      { intent: COMPETITOR_INTENTS.REMOVE, name: competitor.name },
                      { method: "post" },
                    )
                  }
                />
              </s-grid>
            ))}
          </s-stack>
        ) : (
          <s-text color="subdued">No competitors yet.</s-text>
        )}

        <form
          ref={formRef}
          onSubmit={(event) => {
            event.preventDefault();
            add();
          }}
        >
          <s-query-container>
            <s-grid
              gridTemplateColumns="@container (inline-size > 640px) 'minmax(0, 1fr) minmax(0, 1fr) auto', 'minmax(0, 1fr)'"
              gap="base"
              alignItems="end"
            >
              <s-text-field
                name="competitorName"
                label="Competitor name"
                placeholder="Myntra"
                disabled={full}
              />
              <s-text-field
                name="competitorWebsite"
                label="Website (optional)"
                placeholder="myntra.com"
                disabled={full}
              />
              <s-button
                type="submit"
                loading={pending === COMPETITOR_INTENTS.ADD}
                disabled={full}
              >
                Add competitor
              </s-button>
            </s-grid>
          </s-query-container>
          {full && (
            <s-text color="subdued">{`You can watch up to ${MAX_COMPETITORS} competitors.`}</s-text>
          )}
        </form>
      </s-stack>
    </s-section>
  );
}

export default function TrackingSettings() {
  const { overview, domains, shopifyName, storeName, terms, competitors } = useLoaderData();
  const save = useFetcher();
  const formRef = useRef(null);

  const submit = () => {
    const form = formRef.current;
    save.submit(
      {
        answers: form.querySelector("[name=answers]")?.value,
        storeName: form.querySelector("[name=storeName]")?.value ?? "",
        domains: form.querySelector("[name=domains]")?.value ?? "",
        terms: form.querySelector("[name=terms]")?.value ?? "",
      },
      { method: "post" },
    );
  };

  return (
    <s-page heading="Settings">
      <SettingsNav current="tracking" />
      <s-stack direction="block" gap="base">
      <form
        data-save-bar
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
      <s-stack direction="block" gap="base" ref={formRef}>

        {save.data?.ok && (
          <s-banner tone="success" heading="Tracking settings saved">
            {save.data.rescored
              ? `${save.data.rescored} saved answers were re-checked against the new names and domains.`
              : null}
          </s-banner>
        )}
        {save.data?.error && (
          <s-banner tone="critical" heading="Settings weren't saved">
            {save.data.error}
          </s-banner>
        )}

        <s-section heading="Your store in AI answers">
          <s-stack direction="block" gap="base">
            <s-text-field
              name="storeName"
              label="Store name"
              details={`Shown as your store on AI visibility, and an answer naming it counts as a mention. Leave empty to use “${shopifyName}”.`}
              value={storeName}
              placeholder={shopifyName}
            />
            <s-text-field
              name="domains"
              label="Store URL"
              details={`An answer cites you when a source links here. Separate more domains with commas. Leave empty to use ${domains.defaults.join(", ")}.`}
              value={domains.custom ? domains.domains.join(", ") : ""}
              placeholder={domains.defaults.join(", ")}
            />
            <s-text-area
              name="terms"
              label="Other names for your brand"
              details={`Add up to ${MAX_BRAND_TERMS} other names, one per line, matched as whole words in any case.`}
              value={terms.join("\n")}
              rows={3}
            />
          </s-stack>
        </s-section>

        <s-section heading="Tracking runs">
          <s-stack direction="block" gap="base">
            <s-select
              name="answers"
              label="Answers per question, per AI tool"
              details="More answers give a tighter range but use more of your AI tool credits."
              value={String(overview.answers)}
            >
              {Array.from({ length: TRACK.maxAnswers }, (_, index) => index + 1).map((count) => (
                <s-option key={count} value={String(count)}>
                  {String(count)}
                </s-option>
              ))}
            </s-select>
            <s-text color="subdued">
              {`${overview.selectedPrompts} selected questions × ${overview.connectedTools} AI tools × ${overview.answers} answers = ${overview.weeklyRequests} requests per run.`}
              {overview.nextRunAt ? ` Next weekly run ${formatDateTime(overview.nextRunAt)}.` : ""}
            </s-text>
            <s-stack direction="inline" gap="small">
              <s-button href="/app/visibility">Add prompts</s-button>
              <s-button href="/app/settings/tools">Manage AI tools</s-button>
            </s-stack>
          </s-stack>
        </s-section>
      </s-stack>
      </form>
      <Competitors competitors={competitors} />
      </s-stack>
    </s-page>
  );
}

export const headers = (headersArgs) => boundary.headers(headersArgs);

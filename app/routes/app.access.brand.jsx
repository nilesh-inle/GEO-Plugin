import { useEffect, useMemo, useRef, useState } from "react";
import { useFetcher, useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import {
  addSuggestedFacts,
  checkFacts,
  deleteFact,
  listFacts,
  saveFact,
} from "../services/brand.server";
import { publishLlms } from "../services/fixes.server";
import { readBody, requireStore } from "../services/guard.server";
import { AccessNav } from "../components/HubNav";
import { FilterTabs, Metric, MetricGrid } from "../components/ui";
import { FACT_GROUPS, suggestedFacts } from "../lib/brandFacts";
import { FIX_STATUS } from "../lib/constants";
import { formatDateTime } from "../lib/format";

export const loader = async ({ request }) => {
  const { shop, store } = await requireStore(request);
  const facts = await listFacts(shop);
  return {
    facts: facts.map(({ id, group, label, value, updatedAt }) => ({ id, group, label, value, updatedAt })),
    factCheck: store.settings.factCheck ?? null,
    llmsPublished: store.llmsStatus === FIX_STATUS.APPLIED,
    llmsDirty: store.llmsDirty,
    suggestions: suggestedFacts(store).length,
    storeName: store.name,
  };
};

export const action = async ({ request }) => {
  const { admin, shop } = await requireStore(request);
  const body = await readBody(request);
  try {
    switch (body.intent) {
      case "save":
        await saveFact(shop, body);
        return { ok: true, saved: true };
      case "delete":
        await deleteFact(shop, body.id);
        return { ok: true };
      case "suggest":
        return { ok: true, added: await addSuggestedFacts(shop) };
      case "check":
        return { ok: true, factCheck: await checkFacts(shop) };
      case "publish": {
        const result = await publishLlms(admin, shop);
        if (result.status !== FIX_STATUS.APPLIED)
          return { ok: false, error: result.message ?? "llms.txt wasn't published." };
        return { ok: true, published: true };
      }
      default:
        return null;
    }
  } catch (error) {
    return { ok: false, error: error.message };
  }
};

const SAID = {
  consistent: ["success", "Consistent"],
  contradicted: ["critical", "Contradicted"],
  not_mentioned: ["neutral", "Not mentioned"],
};

export default function BrandFacts() {
  const data = useLoaderData();
  const shopify = useAppBridge();
  const act = useFetcher();
  const form = useFetcher();
  const [tab, setTab] = useState("all");
  const [editing, setEditing] = useState(null);
  const labelRef = useRef(null);
  const valueRef = useRef(null);
  const groupRef = useRef(null);
  const results = useMemo(() => data.factCheck?.results ?? {}, [data.factCheck]);

  useEffect(() => {
    if (form.state === "idle" && form.data?.saved) {
      setEditing(null);
      if (labelRef.current) labelRef.current.value = "";
      if (valueRef.current) valueRef.current.value = "";
    }
  }, [form.state, form.data]);

  const counts = useMemo(() => {
    const values = data.facts.map((fact) => results[fact.id]?.status);
    return {
      consistent: values.filter((value) => value === "consistent").length,
      contradicted: values.filter((value) => value === "contradicted").length,
      missing: values.filter((value) => value === "not_mentioned").length,
    };
  }, [data.facts, results]);

  const rows = data.facts.filter((fact) =>
    tab === "all"
      ? true
      : tab === "contradicted"
        ? results[fact.id]?.status === "contradicted"
        : fact.group === tab,
  );

  const knowledgeBase = data.facts.map((fact) => `${fact.label}: ${fact.value}`).join("\n");
  const copyKnowledgeBase = async () => {
    try {
      await navigator.clipboard.writeText(knowledgeBase);
      shopify.toast.show("Facts copied");
    } catch {
      shopify.toast.show("Couldn't copy. Select the text instead.", { isError: true });
    }
  };

  const submitFact = () =>
    form.submit(
      {
        intent: "save",
        id: editing?.id ?? "",
        group: groupRef.current?.value ?? "company",
        label: labelRef.current?.value ?? "",
        value: valueRef.current?.value ?? "",
      },
      { method: "post" },
    );
  const busy = (intent) => act.state !== "idle" && act.formData?.get("intent") === intent;

  return (
    <s-page heading="AI access" inlineSize="large">
      <s-button
        slot="primary-action"
        variant="primary"
        loading={busy("check") || undefined}
        disabled={!data.facts.length || undefined}
        onClick={() => act.submit({ intent: "check" }, { method: "post" })}
      >
        Check AI answers
      </s-button>
      <s-button
        slot="secondary-actions"
        loading={busy("publish") || undefined}
        disabled={!data.facts.length || undefined}
        onClick={() => act.submit({ intent: "publish" }, { method: "post" })}
      >
        {data.llmsPublished ? "Update llms.txt" : "Publish to llms.txt"}
      </s-button>

      <s-stack direction="block" gap="base">
        <AccessNav current="brand" />
        <s-text color="subdued">
          {`One source of truth for what AI should say about ${data.storeName || "your store"}. Facts are published to llms.txt and checked against real AI answers.`}
        </s-text>

        {act.data?.error && (
          <s-banner tone="critical" heading="That didn't work">
            {act.data.error}
          </s-banner>
        )}
        {act.data?.published && (
          <s-banner tone="success" heading="llms.txt updated with your facts" />
        )}
        {data.llmsPublished && data.llmsDirty && !act.data?.published && (
          <s-banner tone="info" heading="llms.txt doesn't have your latest facts">
            Update llms.txt to publish them.
          </s-banner>
        )}

        <MetricGrid>
          <Metric label="Facts" value={data.facts.length} help={Object.values(FACT_GROUPS).join(", ")} />
          <Metric
            label="Consistent in AI answers"
            value={data.factCheck ? counts.consistent : "–"}
            help={data.factCheck ? `From ${data.factCheck.answers} answers that name you` : "Run a check"}
          />
          <Metric
            label="Contradicted"
            value={data.factCheck ? counts.contradicted : "–"}
            help="AI states a different value"
          />
          <Metric
            label="Not mentioned"
            value={data.factCheck ? counts.missing : "–"}
            help={
              data.factCheck
                ? `Checked ${formatDateTime(data.factCheck.checkedAt)}`
                : "Facts no answer states"
            }
          />
        </MetricGrid>

        <s-section padding="none" accessibilityLabel="Facts">
          <s-box padding="base">
            <FilterTabs
              tabs={[
                { key: "all", label: "All", count: data.facts.length },
                ...Object.entries(FACT_GROUPS).map(([key, label]) => ({
                  key,
                  label,
                  count: data.facts.filter((fact) => fact.group === key).length,
                })),
                { key: "contradicted", label: "Contradicted", count: counts.contradicted },
              ]}
              current={tab}
              onSelect={setTab}
            />
          </s-box>
          {data.facts.length ? (
            <s-table>
              <s-table-header-row>
                <s-table-header listSlot="primary">Fact</s-table-header>
                <s-table-header>Your value</s-table-header>
                <s-table-header>Published to</s-table-header>
                <s-table-header>What AI says</s-table-header>
                <s-table-header>Actions</s-table-header>
              </s-table-header-row>
              <s-table-body>
                {rows.map((fact) => (
                  <FactRow
                    key={fact.id}
                    fact={fact}
                    result={results[fact.id]}
                    published={data.llmsPublished && !data.llmsDirty}
                    onEdit={() => setEditing(fact)}
                  />
                ))}
              </s-table-body>
            </s-table>
          ) : (
            <s-box padding="large">
              <s-stack direction="block" gap="small" alignItems="start">
                <s-heading>No facts yet</s-heading>
                <s-paragraph>
                  Start with what GEO can read from Shopify: your return window,
                  where you ship, prices and contact details.
                </s-paragraph>
                <s-button
                  loading={busy("suggest") || undefined}
                  disabled={!data.suggestions || undefined}
                  onClick={() => act.submit({ intent: "suggest" }, { method: "post" })}
                >
                  {`Add ${data.suggestions} suggested facts`}
                </s-button>
              </s-stack>
            </s-box>
          )}
        </s-section>

        <s-section heading={editing ? `Edit “${editing.label}”` : "Add a fact"}>
          <s-stack direction="block" gap="base" key={editing?.id ?? "new"}>
            <s-grid gridTemplateColumns="repeat(auto-fit, minmax(200px, 1fr))" gap="base">
              <s-select ref={groupRef} label="Group" value={editing?.group ?? "company"}>
                {Object.entries(FACT_GROUPS).map(([key, label]) => (
                  <s-option key={key} value={key}>
                    {label}
                  </s-option>
                ))}
              </s-select>
              <s-text-field
                ref={labelRef}
                label="Fact"
                placeholder="Return window"
                value={editing?.label ?? ""}
              />
              <s-text-field
                ref={valueRef}
                label="Your value"
                placeholder="30 days, free return label in the US"
                value={editing?.value ?? ""}
                error={form.data?.error}
              />
            </s-grid>
            <s-stack direction="inline" gap="small">
              <s-button
                variant="primary"
                loading={form.state !== "idle" || undefined}
                onClick={submitFact}
              >
                {editing ? "Save fact" : "Add fact"}
              </s-button>
              {editing && (
                <s-button variant="tertiary" onClick={() => setEditing(null)}>
                  Cancel
                </s-button>
              )}
            </s-stack>
          </s-stack>
        </s-section>

        {data.facts.length > 0 && (
          <s-section heading="Shopify Knowledge Base">
            <s-stack direction="block" gap="small">
              <s-paragraph>
                Shopify&apos;s Knowledge Base app answers shoppers&apos; store
                questions in AI channels. It has no public API, so copy your
                facts and paste them there.
              </s-paragraph>
              <s-text-area label="Facts to paste" value={knowledgeBase} rows={Math.min(8, data.facts.length + 1)} />
              <s-stack direction="inline">
                <s-button onClick={copyKnowledgeBase}>Copy facts</s-button>
              </s-stack>
            </s-stack>
          </s-section>
        )}

        <s-section heading="Why this matters">
          <s-paragraph>
            Assistants answer store questions from your policies, llms.txt and
            your pages. Whether consistent facts everywhere change what AI says
            is likely but unproven, so GEO re-checks real answers instead of
            assuming it worked.
          </s-paragraph>
        </s-section>
      </s-stack>
    </s-page>
  );
}

function FactRow({ fact, result, published, onEdit }) {
  const remove = useFetcher();
  const said = result ? SAID[result.status] : null;
  return (
    <s-table-row>
      <s-table-cell>
        <s-stack direction="block" gap="small-400">
          <s-text type="strong">{fact.label}</s-text>
          <s-text color="subdued">{FACT_GROUPS[fact.group]}</s-text>
        </s-stack>
      </s-table-cell>
      <s-table-cell>{fact.value}</s-table-cell>
      <s-table-cell>
        <s-stack direction="inline" gap="small-300">
          <s-badge tone={published ? "success" : "warning"}>
            {published ? "llms.txt" : "llms.txt · not yet"}
          </s-badge>
          <s-badge tone="info">Knowledge Base · copy</s-badge>
        </s-stack>
      </s-table-cell>
      <s-table-cell>
        {said ? (
          <s-stack direction="block" gap="small-400">
            <s-badge tone={said[0]}>
              {result.status === "contradicted" && result.said
                ? `“${result.said}”`
                : said[1]}
            </s-badge>
            {result.answers > 0 && (
              <s-text color="subdued">{`${result.answers} answers`}</s-text>
            )}
          </s-stack>
        ) : (
          <s-text color="subdued">Not checked</s-text>
        )}
      </s-table-cell>
      <s-table-cell>
        <s-stack direction="inline" gap="small-300">
          <s-button variant="tertiary" onClick={onEdit}>
            Edit
          </s-button>
          <s-button
            variant="tertiary"
            tone="critical"
            loading={remove.state !== "idle" || undefined}
            onClick={() => remove.submit({ intent: "delete", id: fact.id }, { method: "post" })}
          >
            Delete
          </s-button>
        </s-stack>
      </s-table-cell>
    </s-table-row>
  );
}

export const headers = (headersArgs) => boundary.headers(headersArgs);

import { useEffect, useRef } from "react";
import { useFetcher, useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { getStore } from "../services/store.server";
import {
  connectTool,
  disconnectTool,
  getTools,
  getTrackDomains,
  getTrackOverview,
  loadModels,
  startTrackRun,
} from "../services/tracking.server";
import { SettingsNav } from "../components/HubNav";
import { TrackRunStatus } from "../components/TrackRunStatus";
import { TrackTracker } from "../components/TrackTracker";
import { useElementEvent } from "../hooks/useElementEvent";
import { usePolling } from "../hooks/usePolling";
import {
  RUN_STATUS,
  TOOL_STATUS,
  TRACK,
  TRACK_TRIGGER,
} from "../lib/constants";

export const loader = async ({ request }) => {
  const { session, redirect } = await authenticate.admin(request);
  const store = await getStore(session.shop);
  if (!store?.syncedAt) throw redirect("/app");

  const [tools, overview, domains] = await Promise.all([
    getTools(session.shop),
    getTrackOverview(session.shop),
    getTrackDomains(session.shop),
  ]);
  return { tools, overview, domains };
};

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const { shop } = session;
  const form = Object.fromEntries(await request.formData());
  const { intent, provider } = form;

  try {
    switch (intent) {
      case "models":
        return {
          intent,
          provider,
          ...(await loadModels(shop, provider, form.apiKey)),
        };
      case "connect": {
        const { model } = await connectTool(shop, {
          provider,
          apiKey: form.apiKey,
          model: form.model,
        });
        return { intent, provider, ok: true, model };
      }
      case "disconnect":
        await disconnectTool(shop, provider);
        return { intent, provider, ok: true };
      case "run":
        await startTrackRun(shop, { trigger: TRACK_TRIGGER.MANUAL });
        return { intent, ok: true };
      default:
        return { intent, error: "Unknown action." };
    }
  } catch (error) {
    return { intent, provider, error: error.message };
  }
};

// Listing models doesn't change anything, so the page needn't reload.
export const shouldRevalidate = ({ formData, defaultShouldRevalidate }) =>
  formData?.get("intent") === "models" ? false : defaultShouldRevalidate;

export default function ToolsPage() {
  const { tools, overview, domains } = useLoaderData();
  const run = useFetcher();
  const running = overview.run?.status === RUN_STATUS.RUNNING;
  usePolling(running, 3000);

  return (
    <s-page heading="Settings">
      <s-button
        slot="primary-action"
        variant="primary"
        onClick={() => run.submit({ intent: "run" }, { method: "post" })}
        loading={run.state !== "idle" || undefined}
        disabled={
          !overview.connectedTools ||
          !overview.selectedPrompts ||
          running ||
          undefined
        }
      >
        Check selected prompts
      </s-button>
      <s-button slot="secondary-actions" href="/app/visibility">
        View report
      </s-button>

      <s-stack direction="block" gap="base">
        <SettingsNav current="tools" />
        <TrackTracker current={0} />
        <s-paragraph>
          Connect the AI tools your shoppers use. GEO asks each one only the
          prompts you select, with your own API key, and counts how many answers
          cite your store. Nothing is asked until you click Check.
        </s-paragraph>

        {run.data?.error && (
          <s-banner tone="critical">{run.data.error}</s-banner>
        )}
        {overview.connectedTools > 0 && !overview.selectedPrompts && (
          <s-banner tone="info" heading="Next: select the prompts to check">
            {`Add up to ${TRACK.maxPrompts} questions shoppers ask. Only those are sent to your AI tools.`}
            <s-button slot="secondary-actions" href="/app/visibility">
              Add prompts
            </s-button>
          </s-banner>
        )}
        <TrackRunStatus run={overview.run} nextRunAt={overview.nextRunAt} />

        <s-query-container>
          <s-grid
            gridTemplateColumns="@container (inline-size > 640px) 'repeat(2, minmax(0, 1fr))', 'minmax(0, 1fr)'"
            gap="base"
          >
            {tools.map((tool) => (
              <ToolCard key={tool.id} tool={tool} />
            ))}
          </s-grid>
        </s-query-container>

        <s-text color="subdued">
          Answers per prompt and which domains count as citing you are in{" "}
          <s-link href="/app/settings">Tracking settings</s-link>.
        </s-text>

        <s-section heading="About your API keys">
          <s-unordered-list>
            <s-list-item>
              Keys are encrypted and only used to ask the prompts you track.
            </s-list-item>
            <s-list-item>
              Requests are billed to your own account with each AI provider.
            </s-list-item>
            <s-list-item>
              Disconnecting a tool deletes its key. Uninstalling GEO deletes all
              keys.
            </s-list-item>
          </s-unordered-list>
        </s-section>
      </s-stack>

      {tools.map((tool) => (
        <ConnectModal key={tool.id} tool={tool} domains={domains.domains} />
      ))}
    </s-page>
  );
}

function ToolCard({ tool }) {
  const { connection } = tool;
  const failing = connection?.status === TOOL_STATUS.ERROR;

  return (
    <s-section>
      <s-stack direction="block" gap="small">
        <s-stack
          direction="inline"
          gap="small"
          alignItems="center"
          justifyContent="space-between"
        >
          <s-heading>{tool.name}</s-heading>
          {connection ? (
            <s-badge
              tone={failing ? "critical" : "success"}
              icon={failing ? undefined : "check"}
            >
              {failing ? "Needs attention" : "Connected"}
            </s-badge>
          ) : (
            <s-badge tone="neutral">Not connected</s-badge>
          )}
        </s-stack>
        <s-text color="subdued">{tool.description}</s-text>
        {connection && (
          <s-text>
            {`Model ${connection.model} · key ending ${connection.keyHint}`}
          </s-text>
        )}
        {failing && <s-text tone="critical">{connection.lastError}</s-text>}
        <s-stack direction="inline">
          <s-button
            variant={connection ? "secondary" : "primary"}
            commandFor={`connect-${tool.id}`}
            command="--show"
          >
            {connection ? "Manage" : "Connect"}
          </s-button>
        </s-stack>
      </s-stack>
    </s-section>
  );
}

/** API key and model for one AI tool. Models load from the provider once a key is entered. */
function ConnectModal({ tool, domains }) {
  const shopify = useAppBridge();
  const modalRef = useRef(null);
  const keyRef = useRef(null);
  const modelRef = useRef(null);
  const models = useFetcher();
  const connect = useFetcher();
  const disconnect = useFetcher();
  const { connection } = tool;
  const modalId = `connect-${tool.id}`;

  const requestModels = (apiKey = "") =>
    models.submit(
      { intent: "models", provider: tool.id, apiKey },
      { method: "post" },
    );

  useElementEvent(keyRef, "change", (event) => {
    const apiKey = String(event.target.value ?? "").trim();
    if (apiKey.length >= 8) requestModels(apiKey);
  });

  // Managing a connected tool: list models with the saved key.
  useElementEvent(modalRef, "show", () => {
    if (connection && !models.data && models.state === "idle") requestModels();
  });

  useEffect(() => {
    if (connect.state !== "idle" || !connect.data?.ok) return;
    modalRef.current?.hideOverlay();
    shopify.toast.show(
      `${tool.name} connected. Nothing is asked until you check.`,
    );
  }, [connect.state, connect.data, shopify, tool.name]);

  useEffect(() => {
    if (disconnect.state !== "idle" || !disconnect.data?.ok) return;
    modalRef.current?.hideOverlay();
    shopify.toast.show(`${tool.name} disconnected`);
  }, [disconnect.state, disconnect.data, shopify, tool.name]);

  const submitConnect = () =>
    connect.submit(
      {
        intent: "connect",
        provider: tool.id,
        apiKey: String(keyRef.current?.value ?? "").trim(),
        model: modelRef.current?.value ?? "",
      },
      { method: "post" },
    );

  const loaded = models.data?.models;
  const options =
    loaded ??
    (connection ? [{ value: connection.model, label: connection.model }] : []);
  const current =
    connection && options.some((option) => option.value === connection.model)
      ? connection.model
      : (models.data?.recommended ?? options[0]?.value ?? "");
  const loadingModels = models.state !== "idle";

  return (
    <s-modal ref={modalRef} id={modalId} heading={`Connect ${tool.name}`}>
      <s-stack direction="block" gap="base">
        {connect.data?.error && (
          <s-banner tone="critical" heading="Couldn't connect">
            {connect.data.error}
          </s-banner>
        )}

        <s-stack direction="block" gap="small-200">
          <s-password-field
            ref={keyRef}
            name="apiKey"
            label={`${tool.company} API key`}
            placeholder={
              connection
                ? `Saved key ending ${connection.keyHint}`
                : tool.keyPlaceholder
            }
            details={
              connection
                ? "Leave empty to keep the saved key."
                : "Your models load once the key is entered."
            }
            error={models.data?.error}
            autocomplete="new-password"
          />
          <s-link href={tool.keyUrl} target="_blank">
            {`Get an API key from ${tool.company}`}
          </s-link>
        </s-stack>

        <s-select
          key={loaded ? "loaded" : "initial"}
          ref={modelRef}
          name="model"
          label="Model"
          value={current}
          disabled={!options.length || loadingModels || undefined}
          details={
            loadingModels
              ? "Checking your key…"
              : options.length
                ? (tool.modelDetails ??
                  "Answers come from this model with web search on.")
                : "Enter your API key to see the models it can use."
          }
        >
          {options.map((option) => (
            <s-option key={option.value} value={option.value}>
              {option.label}
            </s-option>
          ))}
        </s-select>

        <s-text color="subdued">
          {`Connecting only verifies the key. ${tool.name} is asked your selected prompts when you click Check. Requests are billed to your ${tool.company} account.`}
        </s-text>
        <s-text color="subdued">
          {`Answers count as citing you when they link to ${domains.join(", ")}. Change this in Tracking settings.`}
        </s-text>
      </s-stack>

      <s-button
        slot="primary-action"
        variant="primary"
        onClick={submitConnect}
        loading={connect.state !== "idle" || undefined}
      >
        {connection ? "Save" : "Connect"}
      </s-button>
      <s-button slot="secondary-actions" commandFor={modalId} command="--hide">
        Cancel
      </s-button>
      {connection && (
        <s-button
          slot="secondary-actions"
          tone="critical"
          onClick={() =>
            disconnect.submit(
              { intent: "disconnect", provider: tool.id },
              { method: "post" },
            )
          }
          loading={disconnect.state !== "idle" || undefined}
        >
          Disconnect
        </s-button>
      )}
    </s-modal>
  );
}

export const headers = (headersArgs) => boundary.headers(headersArgs);

import { useEffect } from "react";
import {
  useLoaderData,
  useNavigate,
  useNavigation,
  useSubmit,
} from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { getStore } from "../services/store.server";
import { getLatestRun, parseRun, startSync } from "../services/sync.server";
import { StepTracker } from "../components/StepTracker";
import { usePolling } from "../hooks/usePolling";
import {
  RUN_STATUS,
  STEP_STATUS,
  SYNC_MODE,
  SYNC_STEPS,
} from "../lib/constants";
import { formatNumber } from "../lib/format";

export const loader = async ({ request }) => {
  const { session, redirect } = await authenticate.admin(request);
  const [latest, store] = await Promise.all([
    getLatestRun(session.shop),
    getStore(session.shop),
  ]);
  const run = parseRun(latest);

  if (!run) throw redirect("/app");
  // Verification after a fix is reflected on the Fix list.
  if (run.mode === SYNC_MODE.VERIFY) throw redirect("/app/fixes");

  // First run continues to the audit summary; later scans go to the Fix list.
  const next = store?.optimizedAt ? "/app/fixes" : "/app/optimize/audit";
  return { run, next };
};

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const { intent } = Object.fromEntries(await request.formData());
  await startSync(session.shop, {
    mode: intent === "retry" ? SYNC_MODE.RETRY : SYNC_MODE.FULL,
  });
  return null;
};

const ICONS = {
  [STEP_STATUS.DONE]: { type: "check-circle", tone: "success" },
  [STEP_STATUS.FAILED]: { type: "x-circle", tone: "critical" },
  [STEP_STATUS.PENDING]: { type: "clock", tone: "neutral" },
};

export default function SyncPage() {
  const { run, next } = useLoaderData();
  const navigate = useNavigate();
  const submit = useSubmit();
  const navigation = useNavigation();
  const busy = navigation.state !== "idle";

  const running = run.status === RUN_STATUS.RUNNING;
  const steps = SYNC_STEPS.filter((step) => run.steps[step.key]);
  const failed = steps.filter(
    (step) => run.steps[step.key].status === STEP_STATUS.FAILED,
  );
  const finishedClean =
    run.status === RUN_STATUS.COMPLETED && failed.length === 0;

  usePolling(running, 1500);

  // A clean run moves straight on to the audit.
  useEffect(() => {
    if (finishedClean) navigate(next);
  }, [finishedClean, navigate, next]);

  const start = (intent) => submit({ intent }, { method: "post" });

  return (
    <s-page heading="Getting your store ready for AI">
      <s-stack direction="block" gap="base">
        <StepTracker current={0} />

        {run.status === RUN_STATUS.FAILED && (
          <s-banner tone="critical" heading="The sync stopped">
            {run.error}
            <s-button
              slot="secondary-actions"
              onClick={() => start("full")}
              loading={busy || undefined}
            >
              Start again
            </s-button>
          </s-banner>
        )}

        {run.status === RUN_STATUS.COMPLETED && failed.length > 0 && (
          <s-banner
            tone="warning"
            heading={`${failed.length} ${failed.length === 1 ? "check" : "checks"} failed`}
          >
            Retry just the failed {failed.length === 1 ? "check" : "checks"}, or
            continue to the audit with what was read.
            <s-button
              slot="secondary-actions"
              onClick={() => start("retry")}
              loading={busy || undefined}
            >
              Retry failed
            </s-button>
            <s-button slot="secondary-actions" href={next}>
              Continue
            </s-button>
          </s-banner>
        )}

        <s-section heading={running ? "Syncing your store" : "Sync finished"}>
          <s-stack direction="block" gap="base">
            <s-text color="subdued">
              Reading products, collections and policies. Nothing in your store
              changes.
            </s-text>
            <s-stack direction="block" gap="none">
              {steps.map((step, index) => (
                <StepRow
                  key={step.key}
                  label={step.label}
                  step={run.steps[step.key]}
                  progress={step.key === "schema" ? run.progress : null}
                  first={index === 0}
                />
              ))}
            </s-stack>
          </s-stack>
        </s-section>

        {running && (
          <s-banner tone="info">
            You can leave this page. The scan keeps running, and the results
            will be on Overview and the Fix list when it finishes.
          </s-banner>
        )}
      </s-stack>
    </s-page>
  );
}

function StepRow({ label, step, progress, first }) {
  const isRunning = step.status === STEP_STATUS.RUNNING;
  const icon = ICONS[step.status];
  const showProgress = isRunning && progress?.total > 0;

  return (
    <s-box
      paddingBlock="small"
      borderWidth={first ? "none" : "base none none none"}
      borderColor="subdued"
    >
      <s-stack direction="inline" gap="base" alignItems="center">
        {isRunning ? (
          <s-spinner size="base" accessibilityLabel="In progress" />
        ) : (
          <s-icon type={icon.type} tone={icon.tone} />
        )}
        <s-box inlineSize="100%">
          <s-stack direction="block" gap="small-300">
            <s-text type={isRunning ? "strong" : undefined}>{label}</s-text>
            {showProgress && (
              <s-progress
                value={progress.done}
                max={progress.total}
                accessibilityLabel={label}
              />
            )}
          </s-stack>
        </s-box>
        <s-text color="subdued">
          {showProgress
            ? `${formatNumber(progress.done)} of ${formatNumber(progress.total)}`
            : step.status === STEP_STATUS.PENDING
              ? "Waiting"
              : isRunning
                ? "Working"
                : step.detail || "Done"}
        </s-text>
      </s-stack>
    </s-box>
  );
}

export const headers = (headersArgs) => boundary.headers(headersArgs);

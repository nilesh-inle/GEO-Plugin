import { RUN_STATUS } from "../lib/constants";
import { formatDateTime, formatNumber } from "../lib/format";

/** Progress of the latest tracking run, and when the next weekly check is due. */
export function TrackRunStatus({ run, nextRunAt }) {
  if (run?.status === RUN_STATUS.RUNNING) {
    const { stage = "Starting", done = 0, total = 0 } = run.progress ?? {};
    const label = total
      ? `${stage}: ${formatNumber(done)} of ${formatNumber(total)} answers`
      : stage;
    return (
      <s-banner tone="info" heading="Checking AI answers">
        <s-stack direction="block" gap="small">
          <s-text>{label}</s-text>
          {total > 0 && (
            <s-progress value={done} max={total} accessibilityLabel={label} />
          )}
          <s-text color="subdued">
            You can leave this page. The check keeps running.
          </s-text>
        </s-stack>
      </s-banner>
    );
  }

  if (run?.status === RUN_STATUS.FAILED) {
    return (
      <s-banner tone="critical" heading="The last check didn't finish">
        {run.error}
      </s-banner>
    );
  }

  if (run?.error) {
    return (
      <s-banner tone="warning" heading="Some AI tools were skipped">
        {run.error}
      </s-banner>
    );
  }

  if (!run) return null;
  return (
    <s-text color="subdued">
      {`Last checked ${formatDateTime(run.finishedAt ?? run.startedAt)}.`}
      {nextRunAt ? ` Next check ${formatDateTime(nextRunAt)}.` : ""}
    </s-text>
  );
}

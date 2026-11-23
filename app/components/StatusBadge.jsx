const TONES = {
  ok: "success",
  issue: "critical",
  warning: "warning",
  info: "neutral",
  unknown: "neutral",
};

/** Badge for an audit status ("ok" | "issue" | "warning" | "info" | "unknown"). */
export function StatusBadge({ status, children }) {
  return <s-badge tone={TONES[status] ?? "neutral"}>{children}</s-badge>;
}

/** "4 issues" / "3 warnings" badges, hidden when zero. */
export function CountBadges({ issues = 0, warnings = 0 }) {
  if (!issues && !warnings) return <s-badge tone="success">No issues</s-badge>;
  return (
    <s-stack direction="inline" gap="small-200">
      {issues > 0 && (
        <s-badge tone="critical">{`${issues} ${issues === 1 ? "issue" : "issues"}`}</s-badge>
      )}
      {warnings > 0 && (
        <s-badge tone="warning">{`${warnings} ${warnings === 1 ? "warning" : "warnings"}`}</s-badge>
      )}
    </s-stack>
  );
}

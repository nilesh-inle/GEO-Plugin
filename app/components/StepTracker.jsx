const OPTIMIZE_STEPS = ["Sync and scan", "Audit", "Update"];

/** Progress through the Optimize phase. `current` is a 0-based index. */
export function StepTracker({ current, steps = OPTIMIZE_STEPS }) {
  return (
    <s-stack direction="inline" gap="small-200" alignItems="center">
      {steps.map((label, index) => {
        const done = index < current;
        const active = index === current;
        return (
          <s-badge
            key={label}
            tone={done ? "success" : active ? "info" : "neutral"}
            icon={done ? "check" : undefined}
          >
            {`${index + 1}. ${label}`}
          </s-badge>
        );
      })}
    </s-stack>
  );
}

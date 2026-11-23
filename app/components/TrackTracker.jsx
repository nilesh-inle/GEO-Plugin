const TRACK_STEPS = [
  { label: "AI tools", href: "/app/settings/tools" },
  { label: "Prompts & report", href: "/app/visibility" },
];

/** Links between the Track pages. `current` is a 0-based index. */
export function TrackTracker({ current }) {
  return (
    <s-stack direction="inline" gap="small-200" alignItems="center">
      {TRACK_STEPS.map((step, index) => (
        <s-link key={step.href} href={step.href}>
          <s-badge tone={index === current ? "info" : "neutral"}>
            {`${index + 4}. ${step.label}`}
          </s-badge>
        </s-link>
      ))}
    </s-stack>
  );
}

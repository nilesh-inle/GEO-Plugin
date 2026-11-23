import { useEffect, useState } from "react";
import { useAppBridge } from "@shopify/app-bridge-react";
import { APP_EMBED_HANDLE } from "../lib/constants";

/**
 * Whether the GEO app embed is switched on in the published theme, read
 * from the Shopify admin with App Bridge. Returns null until known, or when
 * the admin can't say (then `fallback` is used).
 */
function useEmbedActive(fallback) {
  const shopify = useAppBridge();
  const [active, setActive] = useState(null);

  useEffect(() => {
    let cancelled = false;
    Promise.resolve(shopify?.app?.extensions?.())
      .then((extensions) => {
        if (cancelled || !Array.isArray(extensions)) return;
        const embeds = extensions
          .filter((extension) => extension.type === "theme_app_extension")
          .flatMap((extension) => extension.activations ?? [])
          .filter((activation) => activation.handle === APP_EMBED_HANDLE);
        if (embeds.length)
          setActive(embeds.some((embed) => embed.status === "active"));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [shopify]);

  return active ?? fallback ?? false;
}

/**
 * Short setup checklist for Overview. It lists what is left, shows progress,
 * and goes away once every step is done or the merchant dismisses it.
 *
 * @param {{
 *   steps: Array<{ key: string, title: string, detail: string, done: boolean, href: string, label: string, external?: boolean }>,
 *   embedFallback: boolean|null,
 *   embedUrl: string,
 *   onDismiss: () => void,
 * }} props
 */
export function SetupGuide({ steps, embedFallback, embedUrl, onDismiss }) {
  const embedActive = useEmbedActive(embedFallback);
  const all = steps.map((step) =>
    step.key === "embed"
      ? { ...step, done: embedActive, href: embedUrl, external: true }
      : step,
  );
  const done = all.filter((step) => step.done).length;
  if (done === all.length) return null;
  const next = all.find((step) => !step.done);

  return (
    <s-section heading="Finish setting up">
      <s-stack direction="block" gap="base">
        <s-stack
          direction="inline"
          gap="base"
          alignItems="center"
          justifyContent="space-between"
        >
          <s-text color="subdued">{`${done} of ${all.length} steps done`}</s-text>
          <s-button variant="tertiary" onClick={onDismiss}>
            Dismiss
          </s-button>
        </s-stack>
        <s-progress
          value={done}
          max={all.length}
          tone="info"
          accessibilityLabel={`${done} of ${all.length} setup steps done`}
        />
        <s-stack direction="block" gap="small">
          {all.map((step) => (
            <s-stack
              key={step.key}
              direction="inline"
              gap="base"
              alignItems="center"
              justifyContent="space-between"
            >
              <s-stack direction="inline" gap="small" alignItems="start">
                {step.done ? (
                  <s-badge tone="success" icon="check">
                    Done
                  </s-badge>
                ) : (
                  <s-badge tone="neutral">To do</s-badge>
                )}
                <s-stack direction="block" gap="small-400">
                  <s-text type={step.done ? undefined : "strong"}>
                    {step.title}
                  </s-text>
                  {!step.done && (
                    <s-text color="subdued">{step.detail}</s-text>
                  )}
                </s-stack>
              </s-stack>
              {!step.done && (
                <s-button
                  variant={step.key === next.key ? "primary" : "secondary"}
                  href={step.href}
                  target={step.external ? "_blank" : undefined}
                >
                  {step.label}
                </s-button>
              )}
            </s-stack>
          ))}
        </s-stack>
      </s-stack>
    </s-section>
  );
}

import { useEffect } from "react";
import { useRevalidator } from "react-router";

/** Re-runs the route loaders every `intervalMs` while `active` is true. */
export function usePolling(active, intervalMs = 2000) {
  const { revalidate, state } = useRevalidator();

  useEffect(() => {
    if (!active) return undefined;
    const timer = setInterval(() => {
      if (state === "idle") revalidate();
    }, intervalMs);
    return () => clearInterval(timer);
  }, [active, intervalMs, revalidate, state]);
}

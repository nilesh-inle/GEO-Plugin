/**
 * Reads current values from Polaris web component fields by name. Polaris
 * fields aren't React-controlled, so forms read them when submitting.
 */
export function readFields(root) {
  const field = (name) => root?.querySelector(`[name="${name}"]`);
  return {
    on: (name) => Boolean(field(name)?.checked),
    value: (name) => field(name)?.value ?? "",
  };
}

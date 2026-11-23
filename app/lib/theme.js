/**
 * Theme helpers that don't need the Admin API.
 */
import { APP_EMBED_HANDLE } from "./constants";

/**
 * Whether the GEO app embed is turned on, from config/settings_data.json.
 * App embed block types look like
 * "shopify://apps/<app>/blocks/<block-handle>/<extension-uid>".
 */
export function isAppEmbedEnabled(settingsJson, handle = APP_EMBED_HANDLE) {
  if (!settingsJson) return false;
  let settings;
  try {
    settings = JSON.parse(
      String(settingsJson).replace(/^\s*\/\*[\s\S]*?\*\//, ""),
    );
  } catch {
    return false;
  }

  const current =
    typeof settings.current === "string"
      ? settings.presets?.[settings.current]
      : settings.current;
  const blocks = Object.values(current?.blocks || {});
  return blocks.some(
    (block) =>
      typeof block?.type === "string" &&
      block.type.includes(`/blocks/${handle}/`) &&
      block.disabled !== true,
  );
}

/** Deep link that opens the theme editor with the app embed ready to turn on. */
export function appEmbedActivationUrl(shop, apiKey, handle = APP_EMBED_HANDLE) {
  return `https://${shop}/admin/themes/current/editor?context=apps&activateAppId=${apiKey}/${handle}`;
}

/** Theme code editor for a file, used by the copy-and-paste fallback. */
export function themeCodeEditorUrl(shop, themeGid, filename) {
  const themeId = String(themeGid || "")
    .split("/")
    .pop();
  return `https://${shop}/admin/themes/${themeId}?key=${encodeURIComponent(filename)}`;
}

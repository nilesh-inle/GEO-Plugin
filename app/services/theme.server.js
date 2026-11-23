/**
 * Theme file access through the Admin API (read_themes / write_themes).
 */
import { assertNoUserErrors, gql } from "./admin.server";
import { THEME_FILES } from "../lib/constants";
import { appEmbedActivationUrl, isAppEmbedEnabled } from "../lib/theme";

/** Theme editor deep link that turns on the GEO app embed. */
export function getEmbedActivationUrl(shop) {
  return appEmbedActivationUrl(shop, process.env.SHOPIFY_API_KEY);
}

export async function getMainTheme(admin) {
  const data = await gql(
    admin,
    `#graphql
    query GeoMainTheme {
      themes(first: 1, roles: [MAIN]) {
        nodes {
          id
          name
        }
      }
    }`,
  );
  const theme = data.themes.nodes[0];
  if (!theme) throw new Error("No published theme found.");
  return theme;
}

/** @returns {Promise<Record<string, string|null>>} filename -> content (null when missing). */
export async function readThemeFiles(admin, themeId, filenames) {
  const data = await gql(
    admin,
    `#graphql
    query GeoThemeFiles($themeId: ID!, $filenames: [String!]!) {
      theme(id: $themeId) {
        files(first: 10, filenames: $filenames) {
          nodes {
            filename
            body {
              ... on OnlineStoreThemeFileBodyText {
                content
              }
            }
          }
        }
      }
    }`,
    { themeId, filenames },
  );

  const found = Object.fromEntries(
    (data.theme?.files?.nodes ?? []).map((file) => [
      file.filename,
      file.body?.content ?? null,
    ]),
  );
  return Object.fromEntries(
    filenames.map((filename) => [filename, found[filename] ?? null]),
  );
}

export async function writeThemeFile(admin, themeId, filename, content) {
  const data = await gql(
    admin,
    `#graphql
    mutation GeoThemeFilesUpsert($themeId: ID!, $files: [OnlineStoreThemeFilesUpsertFileInput!]!) {
      themeFilesUpsert(themeId: $themeId, files: $files) {
        upsertedThemeFiles {
          filename
        }
        userErrors {
          field
          message
          code
        }
      }
    }`,
    { themeId, files: [{ filename, body: { type: "TEXT", value: content } }] },
  );
  assertNoUserErrors(data.themeFilesUpsert, `Saving ${filename}`);
}

export async function deleteThemeFile(admin, themeId, filename) {
  const data = await gql(
    admin,
    `#graphql
    mutation GeoThemeFilesDelete($themeId: ID!, $files: [String!]!) {
      themeFilesDelete(themeId: $themeId, files: $files) {
        deletedThemeFiles {
          filename
        }
        userErrors {
          field
          message
          code
        }
      }
    }`,
    { themeId, files: [filename] },
  );
  assertNoUserErrors(data.themeFilesDelete, `Removing ${filename}`);
}

export async function getAppEmbedStatus(admin, themeId) {
  const files = await readThemeFiles(admin, themeId, [THEME_FILES.settings]);
  return isAppEmbedEnabled(files[THEME_FILES.settings]);
}

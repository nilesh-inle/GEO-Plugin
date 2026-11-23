/**
 * Bulk operations: Shopify's recommended way to export a whole catalog without
 * paginating through rate limits.
 * https://shopify.dev/docs/api/usage/bulk-operations/queries
 */
import { assertNoUserErrors, gql } from "./admin.server";

const TERMINAL = new Set(["COMPLETED", "FAILED", "CANCELED", "EXPIRED"]);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Starts a bulk query, waits for it, and returns the parsed JSONL rows.
 * Child rows (for example variants) carry `__parentId`.
 */
export async function runBulkQuery(
  admin,
  query,
  { pollMs = 1500, timeoutMs = 15 * 60_000 } = {},
) {
  const started = await gql(
    admin,
    `#graphql
    mutation GeoBulkRun($query: String!) {
      bulkOperationRunQuery(query: $query) {
        bulkOperation {
          id
          status
        }
        userErrors {
          field
          message
        }
      }
    }`,
    { query },
  );

  let operation = assertNoUserErrors(
    started.bulkOperationRunQuery,
    "Bulk export",
  ).bulkOperation;
  const deadline = Date.now() + timeoutMs;

  while (!TERMINAL.has(operation.status)) {
    if (Date.now() > deadline)
      throw new Error("The product export took too long. Try the sync again.");
    await sleep(pollMs);
    const polled = await gql(
      admin,
      `#graphql
      query GeoBulkStatus($id: ID!) {
        node(id: $id) {
          ... on BulkOperation {
            id
            status
            errorCode
            url
          }
        }
      }`,
      { id: operation.id },
    );
    operation = polled.node;
  }

  if (operation.status !== "COMPLETED") {
    const reason = operation.errorCode ? ` (${operation.errorCode})` : "";
    throw new Error(
      `Product export ${operation.status.toLowerCase()}${reason}.`,
    );
  }
  if (!operation.url) return [];

  const response = await fetch(operation.url);
  if (!response.ok)
    throw new Error(
      `Product export download failed (HTTP ${response.status}).`,
    );
  const text = await response.text();
  return text
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

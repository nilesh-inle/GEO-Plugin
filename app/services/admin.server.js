/**
 * Thin wrapper around the Admin GraphQL client with consistent error handling.
 */

function messagesFrom(error) {
  const candidates = [
    error?.body?.errors?.graphQLErrors,
    error?.body?.errors,
    error?.errors?.graphQLErrors,
    error?.errors,
  ];
  for (const candidate of candidates) {
    if (Array.isArray(candidate) && candidate.length) {
      return candidate.map((item) => item?.message || String(item));
    }
  }
  return [error?.message || String(error)];
}

export class AdminApiError extends Error {
  constructor(messages, { userErrors = [], cause } = {}) {
    super(messages.join("; "));
    this.name = "AdminApiError";
    this.userErrors = userErrors;
    this.cause = cause;
  }

  /** True when the app lacks a scope or Shopify's approval (for example theme file writes). */
  get isAccessDenied() {
    return /access denied|not approved|requires.*(scope|exemption|permission)|write_themes|ACCESS_DENIED/i.test(
      `${this.message} ${JSON.stringify(this.userErrors)}`,
    );
  }
}

/** Runs a query or mutation and returns `data`. Throws AdminApiError on GraphQL errors. */
export async function gql(admin, query, variables) {
  let response;
  try {
    response = await admin.graphql(
      query,
      variables ? { variables } : undefined,
    );
  } catch (error) {
    throw new AdminApiError(messagesFrom(error), { cause: error });
  }

  const json = await response.json();
  if (json.errors?.length) throw new AdminApiError(messagesFrom(json));
  return json.data;
}

/** Throws when a mutation payload carries userErrors. */
export function assertNoUserErrors(payload, label) {
  const userErrors = payload?.userErrors ?? [];
  if (userErrors.length) {
    throw new AdminApiError(
      [`${label}: ${userErrors.map((error) => error.message).join("; ")}`],
      { userErrors },
    );
  }
  return payload;
}

/**
 * Fetches public storefront URLs the way an AI crawler would.
 */

const USER_AGENT = "Mozilla/5.0 (compatible; GEOAudit/1.0)";
const MAX_BYTES = 3_000_000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const pathname = (url) => {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
};

/** Appends a query parameter so the scan doesn't read a stale CDN copy. */
export function withCacheBuster(url) {
  return `${url}${url.includes("?") ? "&" : "?"}geo_scan=${Date.now()}`;
}

/**
 * GET a storefront URL with timeout and retries on 429/5xx.
 * Never throws: failures come back as { ok: false, status, error }.
 * `redirected` means the final path differs from the requested one.
 */
export async function fetchStorefront(
  url,
  { timeoutMs = 15_000, retries = 2, userAgent = USER_AGENT } = {},
) {
  for (let attempt = 0; ; attempt += 1) {
    const started = Date.now();
    try {
      const response = await fetch(url, {
        redirect: "follow",
        headers: {
          "user-agent": userAgent,
          accept: "text/html,text/plain;q=0.9,*/*;q=0.8",
        },
        signal: AbortSignal.timeout(timeoutMs),
      });

      if (
        (response.status === 429 || response.status >= 500) &&
        attempt < retries
      ) {
        const retryAfter = Number(response.headers.get("retry-after"));
        const wait = retryAfter > 0 ? retryAfter * 1000 : 1000 * 2 ** attempt;
        await response.body?.cancel();
        await sleep(Math.min(wait, 10_000));
        continue;
      }

      const text = (await response.text()).slice(0, MAX_BYTES);
      return {
        ok: response.ok,
        status: response.status,
        finalUrl: response.url,
        redirected: pathname(response.url) !== pathname(url),
        contentType: response.headers.get("content-type") || "",
        text,
        ms: Date.now() - started,
        server: response.headers.get("server") || "",
      };
    } catch (error) {
      if (attempt < retries) {
        await sleep(500 * 2 ** attempt);
        continue;
      }
      return {
        ok: false,
        status: 0,
        finalUrl: url,
        redirected: false,
        contentType: "",
        text: "",
        error: error.message,
        ms: Date.now() - started,
        server: "",
      };
    }
  }
}

/** Runs `worker` over `items` with at most `limit` in flight. Keeps result order. */
export async function mapLimit(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;
  const runners = Array.from(
    { length: Math.min(limit, items.length) },
    async () => {
      while (next < items.length) {
        const index = next;
        next += 1;
        results[index] = await worker(items[index], index);
      }
    },
  );
  await Promise.all(runners);
  return results;
}

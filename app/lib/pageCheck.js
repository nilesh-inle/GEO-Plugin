/**
 * What a crawler received when it fetched a page. Pure functions.
 */

const CHALLENGE =
  /cf-chl|challenge-platform|captcha|access denied|are you a robot|verify you are human|request blocked/i;

/**
 * @param {{ ok: boolean, status: number, finalUrl: string, text: string, error?: string }} response
 * @returns {{ outcome: "ok"|"blocked"|"password"|"error", status: number, note: string|null, seen: string[], noindex: boolean }}
 */
export function analyzeBotPage(response) {
  const text = String(response.text || "");
  let path = "";
  try {
    path = new URL(response.finalUrl).pathname;
  } catch {
    // keep empty
  }

  if (!response.status)
    return {
      outcome: "error",
      status: 0,
      note: response.error || "No response",
      seen: [],
      noindex: false,
    };
  if (path.startsWith("/password"))
    return {
      outcome: "password",
      status: response.status,
      note: "Redirected to the password page",
      seen: [],
      noindex: false,
    };
  if ([401, 403, 429, 503].includes(response.status) || (!response.ok && CHALLENGE.test(text)))
    return {
      outcome: "blocked",
      status: response.status,
      note: CHALLENGE.test(text)
        ? "A bot challenge or firewall answered instead of the page"
        : `HTTP ${response.status}`,
      seen: [],
      noindex: false,
    };
  if (!response.ok)
    return {
      outcome: "error",
      status: response.status,
      note: `HTTP ${response.status}`,
      seen: [],
      noindex: false,
    };

  const seen = [];
  if (/<title[^>]*>[^<]{2,}<\/title>/i.test(text)) seen.push("Title");
  if (/"price"\s*:|itemprop=["']price["']|product:price:amount/i.test(text))
    seen.push("Price");
  if (/"availability"\s*:|InStock|OutOfStock|itemprop=["']availability["']/i.test(text))
    seen.push("Stock");
  if (/"aggregateRating"|"ratingValue"/i.test(text)) seen.push("Reviews");
  const noindex =
    /<meta[^>]+name=["'](robots|googlebot)["'][^>]+content=["'][^"']*noindex/i.test(text);

  return {
    outcome: noindex ? "blocked" : "ok",
    status: response.status,
    note: noindex ? "The page says noindex" : null,
    seen,
    noindex,
  };
}

/** Counts <sitemap> and <url> entries in a sitemap file. */
export function readSitemap(xml) {
  const text = String(xml || "");
  const children = [...text.matchAll(/<sitemap>\s*<loc>([^<]+)<\/loc>/gi)].map(
    (match) => match[1].trim(),
  );
  const urls = (text.match(/<url>/gi) || []).length;
  const kinds = {};
  for (const loc of children) {
    const kind = (loc.match(/sitemap_(\w+?)_\d/) || [])[1] || "other";
    kinds[kind] = (kinds[kind] || 0) + 1;
  }
  return { children, urls, kinds };
}

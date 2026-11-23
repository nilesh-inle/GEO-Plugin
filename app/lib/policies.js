/**
 * Reads facts out of store policy text. Pure functions, safe on the client.
 */

const WORD_NUMBERS = {
  seven: 7,
  fourteen: 14,
  fifteen: 15,
  twenty: 20,
  thirty: 30,
  forty: 40,
  "forty-five": 45,
  sixty: 60,
  ninety: 90,
};

export function stripHtml(html) {
  return String(html || "")
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The return window a refund policy states, in days, or null when it states
 * none. Only numbers in a sentence about returns, refunds or exchanges count.
 */
export function findReturnWindow(policyHtml) {
  const text = stripHtml(policyHtml);
  if (!text) return null;
  const sentences = text.split(/(?<=[.!?])\s+/);
  for (const sentence of sentences) {
    if (!/\b(return|refund|exchange)/i.test(sentence)) continue;
    const match = sentence.match(
      /\b(\d{1,3}|seven|fourteen|fifteen|twenty|thirty|forty-five|forty|sixty|ninety)[\s-]*(?:\(\d{1,3}\)\s*)?(?:calendar\s+|business\s+|working\s+)?days?\b/i,
    );
    if (!match) continue;
    const raw = match[1].toLowerCase();
    const days = WORD_NUMBERS[raw] ?? Number.parseInt(raw, 10);
    if (days >= 1 && days <= 365) return days;
  }
  return null;
}

/** Shopify policy types a store needs before AI shopping channels list it. */
export const REQUIRED_POLICIES = [
  { type: "REFUND_POLICY", label: "Return and refund policy" },
  { type: "PRIVACY_POLICY", label: "Privacy policy" },
  { type: "TERMS_OF_SERVICE", label: "Terms of service" },
];

export function missingPolicies(policyTypes = []) {
  return REQUIRED_POLICIES.filter(
    (policy) => !policyTypes.includes(policy.type),
  );
}

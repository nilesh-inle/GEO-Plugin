/**
 * Encrypts merchants' AI API keys at rest (AES-256-GCM).
 *
 * The encryption key is derived from GEO_ENCRYPTION_KEY, or from the app's
 * SHOPIFY_API_SECRET when that isn't set. Changing either makes stored keys
 * unreadable; merchants then reconnect their AI tools.
 */
import {
  createCipheriv,
  createDecipheriv,
  hkdfSync,
  randomBytes,
} from "node:crypto";

const VERSION = "v1";
const ALGORITHM = "aes-256-gcm";

let cachedKey = null;

function encryptionKey() {
  if (cachedKey) return cachedKey;
  const secret =
    process.env.GEO_ENCRYPTION_KEY || process.env.SHOPIFY_API_SECRET;
  if (!secret) {
    throw new Error(
      "Set GEO_ENCRYPTION_KEY (or SHOPIFY_API_SECRET) to store API keys.",
    );
  }
  cachedKey = Buffer.from(
    hkdfSync("sha256", secret, "geo-app", "ai-tool-api-keys", 32),
  );
  return cachedKey;
}

export function encryptSecret(plain) {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, encryptionKey(), iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [VERSION, iv, cipher.getAuthTag(), data]
    .map((part) => (typeof part === "string" ? part : part.toString("base64")))
    .join(":");
}

/** Returns the plain value, or null when it can't be decrypted. */
export function decryptSecret(value) {
  try {
    const [version, iv, tag, data] = String(value).split(":");
    if (version !== VERSION) return null;
    const decipher = createDecipheriv(
      ALGORITHM,
      encryptionKey(),
      Buffer.from(iv, "base64"),
    );
    decipher.setAuthTag(Buffer.from(tag, "base64"));
    return Buffer.concat([
      decipher.update(Buffer.from(data, "base64")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    return null;
  }
}

/** Last four characters, for display. */
export function keyHint(apiKey) {
  return String(apiKey).trim().slice(-4);
}

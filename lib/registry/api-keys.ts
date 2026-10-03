const KEY_NAMESPACE = "al_live_merchant_";
const BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const RANDOM_LENGTH = 32;
const SHA256_HEX = /^[a-f0-9]{64}$/;

export const MERCHANT_API_KEY_PREFIX = KEY_NAMESPACE;
export const MERCHANT_API_KEY_PATTERN = /^al_live_merchant_[0-9A-Za-z]{32}$/;

export interface GeneratedMerchantApiKey {
  key: string;
  keyPrefix: string;
  keyHash: string;
}

function randomBase62(length: number): string {
  const cryptoApi = globalThis.crypto;
  if (!cryptoApi?.getRandomValues) {
    throw new Error("Secure random number generation is unavailable.");
  }

  let value = "";
  while (value.length < length) {
    const bytes = cryptoApi.getRandomValues(new Uint8Array(Math.max(64, length * 2)));
    for (const byte of bytes) {
      // 248 is the largest multiple of 62 below 256. Discarding the remainder avoids modulo bias.
      if (byte >= 248) continue;
      value += BASE62[byte % BASE62.length];
      if (value.length === length) break;
    }
  }
  return value;
}

export async function hashMerchantApiKey(key: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(key),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

function constantTimeEqual(left: string, right: string): boolean {
  const length = Math.max(left.length, right.length);
  let difference = left.length ^ right.length;
  for (let index = 0; index < length; index += 1) {
    difference |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  }
  return difference === 0;
}

/** Pure verification: validates the key shape, hashes it, and compares without early-exit. */
export async function verifyMerchantApiKey(
  key: string,
  expectedHash: string,
): Promise<boolean> {
  const candidateHash = await hashMerchantApiKey(key);
  const normalizedExpected = expectedHash.toLowerCase();
  const hashMatches = constantTimeEqual(candidateHash, normalizedExpected);
  return MERCHANT_API_KEY_PATTERN.test(key) && SHA256_HEX.test(normalizedExpected) && hashMatches;
}

export async function generateMerchantApiKey(): Promise<GeneratedMerchantApiKey> {
  const key = `${KEY_NAMESPACE}${randomBase62(RANDOM_LENGTH)}`;
  return {
    key,
    keyPrefix: key.slice(0, 12),
    keyHash: await hashMerchantApiKey(key),
  };
}

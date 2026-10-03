import { describe, expect, it } from "vitest";
import {
  generateMerchantApiKey,
  hashMerchantApiKey,
  MERCHANT_API_KEY_PATTERN,
  verifyMerchantApiKey,
} from "../../lib/registry/api-keys.ts";

describe("merchant API keys", () => {
  it("generates keys in the required namespace with 32 base62 characters", async () => {
    const first = await generateMerchantApiKey();
    const second = await generateMerchantApiKey();

    expect(first.key).toMatch(MERCHANT_API_KEY_PATTERN);
    expect(first.key).toHaveLength("al_live_merchant_".length + 32);
    expect(first.keyPrefix).toBe(first.key.slice(0, 12));
    expect(first.keyHash).toMatch(/^[a-f0-9]{64}$/);
    expect(first.keyHash).not.toBe(first.key);
    expect(second.key).not.toBe(first.key);
  });

  it("hashes keys deterministically with SHA-256", async () => {
    const key = "al_live_merchant_0123456789ABCDEFGHIJKLMNOPQRSTUV";
    const first = await hashMerchantApiKey(key);
    const second = await hashMerchantApiKey(key);

    expect(first).toBe(second);
    expect(first).toBe("1b65dd31c523ded75663092646e9ea01e6151630a575c8825dfcccc53661b35c");
  });

  it("verifies only the exact well-formed key", async () => {
    const generated = await generateMerchantApiKey();
    const replacement = generated.key.endsWith("A") ? "B" : "A";
    const changedKey = `${generated.key.slice(0, -1)}${replacement}`;

    await expect(verifyMerchantApiKey(generated.key, generated.keyHash)).resolves.toBe(true);
    await expect(verifyMerchantApiKey(changedKey, generated.keyHash)).resolves.toBe(false);
    await expect(
      verifyMerchantApiKey(generated.key.replace("al_live_", "al_test_"), generated.keyHash),
    ).resolves.toBe(false);
    await expect(verifyMerchantApiKey(generated.key, "not-a-hash")).resolves.toBe(false);
    await expect(
      verifyMerchantApiKey(generated.key, generated.keyHash.toUpperCase()),
    ).resolves.toBe(true);
  });
});

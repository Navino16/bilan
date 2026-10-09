import { describe, it, expect } from "vitest";
import { hmacForSearch, hmacTokens } from "@/server/crypto/hmac";
import { tokenize } from "@/lib/text";

const key = Buffer.alloc(32, 3);

describe("hmac search", () => {
  it("is deterministic and normalizes accents/case/space", () => {
    expect(hmacForSearch("  Épicerie  CENTRE ", key)).toBe(hmacForSearch("epicerie centre", key));
  });

  it("tokenizes into words >= 3 chars, deduped", () => {
    expect(tokenize("CB AMAZON EU 42")).toEqual(["amazon"]);
  });

  it("hashes each word prefix", () => {
    expect(hmacTokens("AMAZON resto", key)).toEqual(
      ["ama", "amaz", "amazo", "amazon", "res", "rest", "resto"].map((p) => hmacForSearch(p, key)),
    );
  });

  // Golden values: a change here means every stored search token is stale.
  it("keeps the stored token format stable", () => {
    expect(hmacForSearch("Crème  Brûlée ", key)).toBe(
      "057c93a8e516157c55f6a7fad5e669ed6ba9ac46ab26190c692503ba11d42eb8",
    );
    expect(hmacTokens("Crème  Brûlée ", key)).toEqual(
      expect.arrayContaining([
        "a71695b88fc61a50fa51f50079ea7c9e0e887ef9e14eaf448d00c163f1721ba7",
        "42774b1fbffe93c1106da70f0433ea39246c1f153fa0b6263583745faf9d3e9a",
      ]),
    );
  });
});

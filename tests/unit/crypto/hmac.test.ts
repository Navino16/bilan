import { describe, it, expect } from "vitest";
import { hmacForSearch, tokenize, hmacTokens } from "@/server/crypto/hmac";

const key = Buffer.alloc(32, 3);

describe("hmac search", () => {
  it("is deterministic and normalizes accents/case/space", () => {
    expect(hmacForSearch("  Épicerie  CENTRE ", key)).toBe(hmacForSearch("epicerie centre", key));
  });

  it("tokenizes into words >= 3 chars, deduped", () => {
    expect(tokenize("CB AMAZON EU 42")).toEqual(["amazon"]);
  });

  it("hashes each token", () => {
    expect(hmacTokens("AMAZON resto", key)).toHaveLength(2);
  });
});

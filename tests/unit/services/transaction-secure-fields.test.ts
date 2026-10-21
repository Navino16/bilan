import { describe, it, expect } from "vitest";
import { decrypt } from "@/server/crypto/encryption";
import { hmacForSearch } from "@/server/crypto/hmac";
import { dataKey, searchKey } from "@/server/crypto/keys";
import {
  buildSecureFields,
  computeExternalId,
  hashMerchantKey,
} from "@/server/services/transactions/secure-fields";

describe("buildSecureFields", () => {
  it("encrypts label/rawLabel and stores matching HMAC hashes + per-word tokens", () => {
    const f = buildSecureFields({
      label: "Carrefour City",
      rawLabel: "CB CARREFOUR CITY PARIS",
      note: "lunch",
    });
    expect(decrypt(f.labelEnc, dataKey)).toBe("Carrefour City");
    expect(decrypt(f.rawLabelEnc, dataKey)).toBe("CB CARREFOUR CITY PARIS");
    expect(f.noteEnc).not.toBeNull();
    expect(decrypt(f.noteEnc!, dataKey)).toBe("lunch");
    expect(f.labelHash).toBe(hmacForSearch("Carrefour City", searchKey));
    // tokens are per normalized word ≥ 3 chars of the raw label
    expect(f.tokens).toContain(hmacForSearch("carrefour", searchKey));
    expect(f.tokens).toContain(hmacForSearch("city", searchKey));
    expect(f.tokens).toContain(hmacForSearch("paris", searchKey));
    // "cb" (2 chars) is below the 3-char threshold
    expect(f.tokens).not.toContain(hmacForSearch("cb", searchKey));
  });

  // The merchant directory groups rows on it (#296): it follows the label, not the raw label.
  it("hashes the merchant key of the label", () => {
    const f = buildSecureFields({ label: "CB Crème 12/03", rawLabel: "PRLV OTHER" });
    expect(f.merchantKeyHash).toBe(hashMerchantKey("CREME"));
    expect(f.merchantKeyHash).not.toBe(hmacForSearch("CREME", searchKey));
  });

  it("leaves noteEnc null when no note is given", () => {
    const f = buildSecureFields({ label: "X", rawLabel: "X" });
    expect(f.noteEnc).toBeNull();
  });
});

describe("computeExternalId", () => {
  it("is deterministic for the same date+amount+rawLabel and differs otherwise", () => {
    const a = computeExternalId(new Date("2026-01-15"), 12.5, "CB FOO");
    const b = computeExternalId(new Date("2026-01-15"), 12.5, "CB FOO");
    const c = computeExternalId(new Date("2026-01-15"), 12.51, "CB FOO");
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).toHaveLength(64); // sha256 hex
  });
});

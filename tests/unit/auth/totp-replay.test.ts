import { describe, it, expect } from "vitest";
import { hotp, matchTotpStep } from "@/server/auth/totp-replay";

const secret = "12345678901234567890";

describe("TOTP step matching (#223)", () => {
  it("generates RFC 4226 HOTP test vectors", () => {
    expect([0, 1, 2, 9].map((c) => hotp(secret, c))).toEqual([
      "755224",
      "287082",
      "359152",
      "520489",
    ]);
  });

  it("returns the matched step within ±1 of now, null otherwise", () => {
    const now = 1000 * 30_000 + 5_000;
    expect(matchTotpStep(secret, hotp(secret, 1000), now)).toBe(1000);
    expect(matchTotpStep(secret, hotp(secret, 999), now)).toBe(999);
    expect(matchTotpStep(secret, hotp(secret, 1001), now)).toBe(1001);
    expect(matchTotpStep(secret, hotp(secret, 998), now)).toBeNull();
  });
});

import { describe, it, expect } from "vitest";
import { IBAN_REVEAL_WINDOW_MS, isRecentSignIn } from "@/server/services/accounts/iban-reveal";

describe("isRecentSignIn (#257)", () => {
  const now = Date.parse("2026-10-19T12:00:00Z");
  const ago = (ms: number) => new Date(now - ms);

  it("accepts a session signed in less than 10 minutes ago", () => {
    expect(IBAN_REVEAL_WINDOW_MS).toBe(10 * 60_000);
    expect(isRecentSignIn(ago(0), now)).toBe(true);
    expect(isRecentSignIn(ago(IBAN_REVEAL_WINDOW_MS - 1), now)).toBe(true);
  });

  it("refuses a session at or past the 10-minute window", () => {
    expect(isRecentSignIn(ago(IBAN_REVEAL_WINDOW_MS), now)).toBe(false);
    expect(isRecentSignIn(ago(24 * 60 * 60_000), now)).toBe(false);
  });
});

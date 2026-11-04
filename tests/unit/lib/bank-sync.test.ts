import { describe, expect, it } from "vitest";
import { balanceGapLink, consentState } from "@/lib/bank-sync";

const now = new Date("2026-11-03T10:00:00.000Z");
const inDays = (d: number) => new Date(now.getTime() + d * 86_400_000);

describe("consentState", () => {
  it("warns from 14 days before the end", () => {
    expect(consentState(inDays(15), now)).toEqual({ daysLeft: 15, warn: false, expired: false });
    expect(consentState(inDays(14), now)).toEqual({ daysLeft: 14, warn: true, expired: false });
    expect(consentState(inDays(0.5), now)).toEqual({ daysLeft: 1, warn: true, expired: false });
  });

  it("is expired once the end has passed", () => {
    expect(consentState(now, now)).toEqual({ daysLeft: 0, warn: false, expired: true });
    expect(consentState(inDays(-3), now)).toEqual({ daysLeft: 0, warn: false, expired: true });
  });
});

describe("balanceGapLink", () => {
  it("lists the account's transactions in the week up to the bank balance day", () => {
    expect(balanceGapLink("fr", "acc1", "2026-10-31")).toBe(
      "/fr/transactions?accountId=acc1&from=2026-10-24&to=2026-10-31",
    );
    expect(balanceGapLink("en", "acc1", "2026-03-03")).toBe(
      "/en/transactions?accountId=acc1&from=2026-02-24&to=2026-03-03",
    );
  });
});

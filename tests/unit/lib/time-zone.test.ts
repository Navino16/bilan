import { describe, it, expect } from "vitest";
import { isValidTimeZone, nextIsoDay, zonedDayStart } from "@/lib/time-zone";

describe("isValidTimeZone", () => {
  it("accepts IANA zones and rejects garbage", () => {
    expect(isValidTimeZone("Europe/Paris")).toBe(true);
    expect(isValidTimeZone("UTC")).toBe(true);
    expect(isValidTimeZone("Not/AZone")).toBe(false);
    expect(isValidTimeZone("")).toBe(false);
    expect(isValidTimeZone(undefined)).toBe(false);
  });
});

describe("zonedDayStart", () => {
  it("is UTC midnight in UTC", () => {
    expect(zonedDayStart("2026-10-06", "UTC").toISOString()).toBe("2026-10-06T00:00:00.000Z");
  });

  it("handles summer and winter time in Paris", () => {
    expect(zonedDayStart("2026-07-01", "Europe/Paris").toISOString()).toBe(
      "2026-06-30T22:00:00.000Z",
    );
    expect(zonedDayStart("2026-01-15", "Europe/Paris").toISOString()).toBe(
      "2026-01-14T23:00:00.000Z",
    );
  });

  it("handles DST change days and zones west of UTC", () => {
    expect(zonedDayStart("2026-03-29", "Europe/Paris").toISOString()).toBe(
      "2026-03-28T23:00:00.000Z",
    );
    expect(zonedDayStart("2026-03-30", "Europe/Paris").toISOString()).toBe(
      "2026-03-29T22:00:00.000Z",
    );
    expect(zonedDayStart("2026-10-25", "Europe/Paris").toISOString()).toBe(
      "2026-10-24T22:00:00.000Z",
    );
    expect(zonedDayStart("2026-10-26", "Europe/Paris").toISOString()).toBe(
      "2026-10-25T23:00:00.000Z",
    );
    expect(zonedDayStart("2026-10-06", "America/New_York").toISOString()).toBe(
      "2026-10-06T04:00:00.000Z",
    );
  });

  it("starts the day at 01:00 when DST skips midnight, and at the repeated midnight", () => {
    expect(zonedDayStart("2026-09-06", "America/Santiago").toISOString()).toBe(
      "2026-09-06T04:00:00.000Z",
    );
    expect(zonedDayStart("2026-04-05", "America/Santiago").toISOString()).toBe(
      "2026-04-05T04:00:00.000Z",
    );
  });
});

describe("nextIsoDay", () => {
  it("rolls over months and years", () => {
    expect(nextIsoDay("2026-02-28")).toBe("2026-03-01");
    expect(nextIsoDay("2026-12-31")).toBe("2027-01-01");
  });
});

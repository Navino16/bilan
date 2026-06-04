import { describe, it, expect } from "vitest";
import { monthPeriod, addMonths, previousMonthPeriod, parsePeriodParams } from "@/lib/period";

describe("monthPeriod", () => {
  it("returns the inclusive UTC bounds of a month", () => {
    const p = monthPeriod(2026, 2); // February 2026
    expect(p.from.toISOString()).toBe("2026-02-01T00:00:00.000Z");
    expect(p.to.toISOString()).toBe("2026-02-28T23:59:59.999Z");
    expect(p.year).toBe(2026);
    expect(p.month).toBe(2);
  });
});

describe("addMonths", () => {
  it("moves month index, wrapping the year", () => {
    expect(addMonths(2026, 1, -1)).toEqual({ year: 2025, month: 12 });
    expect(addMonths(2026, 12, 1)).toEqual({ year: 2027, month: 1 });
  });
});

describe("previousMonthPeriod", () => {
  it("returns the calendar month before a month period", () => {
    const prev = previousMonthPeriod(monthPeriod(2026, 3));
    expect(prev.from.toISOString()).toBe("2026-02-01T00:00:00.000Z");
    expect(prev.to.toISOString()).toBe("2026-02-28T23:59:59.999Z");
  });
});

describe("parsePeriodParams", () => {
  it("parses from/to ISO days into a custom period", () => {
    const p = parsePeriodParams({ from: "2026-01-10", to: "2026-01-20" });
    expect(p.from.toISOString()).toBe("2026-01-10T00:00:00.000Z");
    expect(p.to.toISOString()).toBe("2026-01-20T23:59:59.999Z");
    expect(p.month).toBeNull(); // not a whole-month period
  });

  it("falls back to a given current month when params are absent/invalid", () => {
    const p = parsePeriodParams({}, { year: 2026, month: 5 });
    expect(p.month).toBe(5);
    expect(p.from.toISOString()).toBe("2026-05-01T00:00:00.000Z");
  });

  it("recognises a from/to range that spans a whole calendar month", () => {
    // Month nav pushes ?from=YYYY-MM-01&to=YYYY-MM-<last> — these must round-trip
    // back to a month period so prev/next keep stepping by one calendar month.
    const p = parsePeriodParams({ from: "2026-05-01", to: "2026-05-31" });
    expect(p.year).toBe(2026);
    expect(p.month).toBe(5);
  });

  it("keeps a non-whole-month range as a custom period", () => {
    const p = parsePeriodParams({ from: "2026-05-01", to: "2026-05-30" });
    expect(p.month).toBeNull();
  });
});

import { describe, it, expect } from "vitest";
import {
  monthPeriod,
  addMonths,
  previousMonthPeriod,
  parsePeriodParams,
  clampPeriodToNow,
  presetPeriod,
  previousPeriod,
  PERIOD_PRESETS,
  formatPeriodLabel,
} from "@/lib/period";

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

describe("clampPeriodToNow", () => {
  const now = new Date("2026-06-15T12:00:00.000Z");

  it("snaps a fully-future month back to the current month", () => {
    const p = clampPeriodToNow(monthPeriod(2027, 1), now);
    expect(p.year).toBe(2026);
    expect(p.month).toBe(6);
  });

  it("leaves a past month untouched", () => {
    const p = clampPeriodToNow(monthPeriod(2026, 5), now);
    expect(p.month).toBe(5);
  });

  it("leaves the current month untouched", () => {
    const p = clampPeriodToNow(monthPeriod(2026, 6), now);
    expect(p.month).toBe(6);
  });

  it("clamps a range that spills into the future to the end of the current month", () => {
    const p = clampPeriodToNow(
      {
        from: new Date("2026-05-10T00:00:00.000Z"),
        to: new Date("2026-08-20T23:59:59.999Z"),
        year: null,
        month: null,
      },
      now,
    );
    expect(p.from.toISOString()).toBe("2026-05-10T00:00:00.000Z");
    expect(p.to.toISOString()).toBe("2026-06-30T23:59:59.999Z");
  });
});

describe("presetPeriod", () => {
  const now = new Date("2026-05-15T12:00:00.000Z");
  it("this-month spans the current calendar month", () => {
    const p = presetPeriod("this-month", now);
    expect(p.from.toISOString()).toBe("2026-05-01T00:00:00.000Z");
    expect(p.month).toBe(5);
  });
  it("last-month spans the previous calendar month", () => {
    const p = presetPeriod("last-month", now);
    expect(p.month).toBe(4);
  });
  it("this-quarter spans Apr–Jun for May", () => {
    const p = presetPeriod("this-quarter", now);
    expect(p.from.toISOString()).toBe("2026-04-01T00:00:00.000Z");
    expect(p.to.toISOString()).toBe("2026-06-30T23:59:59.999Z");
    expect(p.month).toBeNull();
  });
  it("this-year spans the calendar year", () => {
    const p = presetPeriod("this-year", now);
    expect(p.from.toISOString()).toBe("2026-01-01T00:00:00.000Z");
    expect(p.to.toISOString()).toBe("2026-12-31T23:59:59.999Z");
  });
  it("exposes the preset ids", () => {
    expect(PERIOD_PRESETS).toContain("this-quarter");
  });
});

describe("previousPeriod", () => {
  it("returns the same-length window immediately before a custom range", () => {
    const p = previousPeriod({
      from: new Date("2026-05-10T00:00:00.000Z"),
      to: new Date("2026-05-20T23:59:59.999Z"),
      year: null,
      month: null,
    });
    // 11-day window → previous 11 days ending the day before `from`.
    expect(p.to.toISOString().slice(0, 10)).toBe("2026-05-09");
    expect(p.from.toISOString().slice(0, 10)).toBe("2026-04-29");
  });
});

describe("formatPeriodLabel", () => {
  it("labels a whole month with a capitalised month + year", () => {
    expect(formatPeriodLabel(monthPeriod(2026, 5), "fr")).toBe("Mai 2026");
  });

  it("labels a whole calendar year with just the year", () => {
    expect(
      formatPeriodLabel(presetPeriod("this-year", new Date("2026-03-01T00:00:00.000Z")), "fr"),
    ).toBe("2026");
  });

  it("labels a whole quarter as Tn (fr) / Qn (en)", () => {
    const q = presetPeriod("this-quarter", new Date("2026-05-15T00:00:00.000Z"));
    expect(formatPeriodLabel(q, "fr")).toBe("T2 2026");
    expect(formatPeriodLabel(q, "en")).toBe("Q2 2026");
  });

  it("labels an arbitrary range as a localized date range", () => {
    const label = formatPeriodLabel(
      {
        from: new Date("2026-04-10T00:00:00.000Z"),
        to: new Date("2026-04-30T23:59:59.999Z"),
        year: null,
        month: null,
      },
      "fr",
    );
    expect(label).toMatch(/10/);
    expect(label).toMatch(/30/);
    expect(label).toMatch(/avr/i);
    expect(label).toMatch(/2026/);
  });
});

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
  shiftPeriod,
  periodInProgress,
  historyMonths,
  parseBaseline,
  comparisonFor,
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

  it("keeps a period that contains now but extends into the future (current year/quarter)", () => {
    // The current year: Jan→Dec; its later months are simply empty, not trimmed.
    const year = presetPeriod("this-year", now);
    const p = clampPeriodToNow(year, now);
    expect(p.from.toISOString()).toBe("2026-01-01T00:00:00.000Z");
    expect(p.to.toISOString()).toBe("2026-12-31T23:59:59.999Z");
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

  it("returns the previous calendar month for a month period", () => {
    const p = previousPeriod(monthPeriod(2026, 1));
    expect(p).toMatchObject({ year: 2025, month: 12 });
  });

  it("returns the aligned previous quarter for a whole-quarter period", () => {
    const q2 = presetPeriod("this-quarter", new Date("2026-05-15T00:00:00.000Z"));
    const prev = previousPeriod(q2);
    expect(prev.from.toISOString()).toBe("2026-01-01T00:00:00.000Z");
    expect(prev.to.toISOString()).toBe("2026-03-31T23:59:59.999Z");
  });

  it("returns the previous calendar year for a whole-year period", () => {
    const year = presetPeriod("this-year", new Date("2026-03-01T00:00:00.000Z"));
    const prev = previousPeriod(year);
    expect(prev.from.toISOString()).toBe("2025-01-01T00:00:00.000Z");
    expect(prev.to.toISOString()).toBe("2025-12-31T23:59:59.999Z");
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

  it("labels a whole quarter as a month range so the span is clear", () => {
    const q = presetPeriod("this-quarter", new Date("2026-05-15T00:00:00.000Z"));
    const fr = formatPeriodLabel(q, "fr");
    expect(fr).toMatch(/avr/i);
    expect(fr).toMatch(/juin/i);
    expect(fr).toMatch(/2026/);
    expect(fr).not.toMatch(/T2/);
    const en = formatPeriodLabel(q, "en");
    expect(en).toMatch(/apr/i);
    expect(en).toMatch(/jun/i);
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

describe("shiftPeriod", () => {
  it("steps a month period by one calendar month", () => {
    expect(shiftPeriod(monthPeriod(2026, 6), 1)).toMatchObject({ year: 2026, month: 7 });
    expect(shiftPeriod(monthPeriod(2026, 1), -1)).toMatchObject({ year: 2025, month: 12 });
  });

  it("steps a whole year by one year", () => {
    const year = presetPeriod("this-year", new Date("2026-03-01T00:00:00.000Z"));
    const next = shiftPeriod(year, 1);
    expect(next.from.toISOString()).toBe("2027-01-01T00:00:00.000Z");
    expect(next.to.toISOString()).toBe("2027-12-31T23:59:59.999Z");
  });

  it("steps a whole quarter by one quarter, staying aligned", () => {
    const q2 = presetPeriod("this-quarter", new Date("2026-05-15T00:00:00.000Z"));
    const q3 = shiftPeriod(q2, 1);
    expect(q3.from.toISOString()).toBe("2026-07-01T00:00:00.000Z");
    expect(q3.to.toISOString()).toBe("2026-09-30T23:59:59.999Z");
    const q1 = shiftPeriod(q2, -1);
    expect(q1.from.toISOString()).toBe("2026-01-01T00:00:00.000Z");
    expect(q1.to.toISOString()).toBe("2026-03-31T23:59:59.999Z");
  });

  it("steps a quarter across a year boundary", () => {
    const q4 = presetPeriod("this-quarter", new Date("2026-11-15T00:00:00.000Z"));
    const q1Next = shiftPeriod(q4, 1);
    expect(q1Next.from.toISOString()).toBe("2027-01-01T00:00:00.000Z");
    expect(q1Next.to.toISOString()).toBe("2027-03-31T23:59:59.999Z");
  });

  it("shifts an arbitrary range by its own length", () => {
    const range = {
      from: new Date("2026-04-10T00:00:00.000Z"),
      to: new Date("2026-04-20T23:59:59.999Z"),
      year: null,
      month: null,
    };
    const prev = shiftPeriod(range, -1);
    expect(prev.from.toISOString().slice(0, 10)).toBe("2026-03-30");
    expect(prev.to.toISOString().slice(0, 10)).toBe("2026-04-09");
  });
});

describe("periodInProgress", () => {
  const now = new Date("2026-09-28T12:00:00.000Z");
  it("is true for the period containing now", () => {
    expect(periodInProgress(monthPeriod(2026, 9), now)).toBe(true);
  });
  it("is false for a past or future period", () => {
    expect(periodInProgress(monthPeriod(2026, 8), now)).toBe(false);
    expect(periodInProgress(monthPeriod(2026, 10), now)).toBe(false);
  });
  it("includes both bounds", () => {
    const p = monthPeriod(2026, 9);
    expect(periodInProgress(p, p.from)).toBe(true);
    expect(periodInProgress(p, p.to)).toBe(true);
  });
});

describe("historyMonths", () => {
  const now = new Date(Date.UTC(2026, 9, 5));

  it("ends at the period's last month, oldest first, wrapping the year", () => {
    const months = historyMonths(monthPeriod(2026, 3), 12, now);
    expect(months).toHaveLength(12);
    expect(months[0]).toEqual({ year: 2025, month: 4 });
    expect(months[11]).toEqual({ year: 2026, month: 3 });
  });

  it("never ends after the current month", () => {
    const months = historyMonths(presetPeriod("this-year", now), 6, now);
    expect(months[0]).toEqual({ year: 2026, month: 5 });
    expect(months[5]).toEqual({ year: 2026, month: 10 });
  });
});

describe("parseBaseline", () => {
  it("accepts the average baselines on a month period only", () => {
    expect(parseBaseline("avg6", monthPeriod(2026, 10))).toBe("avg6");
    expect(
      parseBaseline("avg6", presetPeriod("this-quarter", new Date(Date.UTC(2026, 9, 5)))),
    ).toBe("prev");
    expect(parseBaseline("avg5", monthPeriod(2026, 10))).toBe("prev");
    expect(parseBaseline(undefined, monthPeriod(2026, 10))).toBe("prev");
    expect(parseBaseline("avg3", parsePeriodParams({ from: "2026-10-03", to: "2026-10-20" }))).toBe(
      "prev",
    );
  });
});

describe("comparisonFor", () => {
  const now = new Date(Date.UTC(2026, 9, 5, 14, 30));
  const day = (d: Date) => d.toISOString();

  it("cuts the previous month to the same elapsed days while the month is in progress", () => {
    const c = comparisonFor(monthPeriod(2026, 10), "prev", now);
    expect(c.elapsedDays).toBe(5);
    expect(day(c.previous.from)).toBe("2026-09-01T00:00:00.000Z");
    expect(day(c.previous.to)).toBe("2026-09-05T23:59:59.999Z");
    expect(c.months).toEqual([]);
  });

  it("compares whole periods once the period is over", () => {
    const c = comparisonFor(monthPeriod(2026, 9), "prev", now);
    expect(c.elapsedDays).toBeNull();
    expect(c.previous).toEqual(monthPeriod(2026, 8));
  });

  it("never runs past the end of a shorter previous month", () => {
    const c = comparisonFor(monthPeriod(2026, 10), "prev", new Date(Date.UTC(2026, 9, 31, 8)));
    expect(day(c.previous.to)).toBe("2026-09-30T23:59:59.999Z");
  });

  it("cuts a quarter in progress to the same number of days", () => {
    const c = comparisonFor(presetPeriod("this-quarter", now), "prev", now);
    expect(day(c.previous.from)).toBe("2026-07-01T00:00:00.000Z");
    expect(day(c.previous.to)).toBe("2026-07-05T23:59:59.999Z");
    // Day 64 of Q1 2027 (March 5th) lands on December 3rd, not the 5th.
    const march = new Date(Date.UTC(2027, 2, 5, 9));
    expect(day(comparisonFor(presetPeriod("this-quarter", march), "prev", march).previous.to)).toBe(
      "2026-12-03T23:59:59.999Z",
    );
  });

  it("averages whole months once the selected month is over", () => {
    const c = comparisonFor(monthPeriod(2026, 9), "avg3", now);
    expect(c.elapsedDays).toBeNull();
    expect(c.months).toEqual([
      { year: 2026, month: 6 },
      { year: 2026, month: 7 },
      { year: 2026, month: 8 },
    ]);
  });

  it("lists the N whole months before the selected month for an average", () => {
    const c = comparisonFor(monthPeriod(2026, 10), "avg6", now);
    expect(c.months[0]).toEqual({ year: 2026, month: 4 });
    expect(c.months[5]).toEqual({ year: 2026, month: 9 });
    expect(c.elapsedDays).toBe(5);
  });
});

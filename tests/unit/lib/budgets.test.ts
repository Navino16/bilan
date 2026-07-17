import { describe, it, expect } from "vitest";
import { budgetPlannedTotal, lineStatus, nextPeriod } from "@/lib/budgets";

describe("budgetPlannedTotal", () => {
  it("sums line planned amounts, rounded to cents", () => {
    expect(budgetPlannedTotal([{ plannedAmount: 100 }, { plannedAmount: 49.9 }])).toBe(149.9);
    expect(budgetPlannedTotal([])).toBe(0);
  });
});

describe("lineStatus", () => {
  it("is OK below 80%", () => {
    expect(lineStatus(100, 50)).toEqual({
      plannedAmount: 100,
      spent: 50,
      remaining: 50,
      percent: 50,
      status: "OK",
    });
  });
  it("is WARN at 80%..100%", () => {
    expect(lineStatus(100, 80).status).toBe("WARN");
    expect(lineStatus(100, 100).status).toBe("WARN");
  });
  it("is OVER above planned", () => {
    const s = lineStatus(100, 120);
    expect(s.status).toBe("OVER");
    expect(s.remaining).toBe(-20);
    expect(s.percent).toBe(120);
  });
  it("handles a zero planned amount", () => {
    expect(lineStatus(0, 0)).toMatchObject({ percent: 0, status: "OK" });
    expect(lineStatus(0, 10)).toMatchObject({ percent: 100, status: "OVER" });
  });
});

describe("nextPeriod", () => {
  it("shifts a month period to the next month (UTC inclusive bounds)", () => {
    const p = nextPeriod(
      "MONTH",
      new Date("2026-03-01T00:00:00.000Z"),
      new Date("2026-03-31T23:59:59.999Z"),
    );
    expect(p.start.toISOString()).toBe("2026-04-01T00:00:00.000Z");
    expect(p.end.toISOString()).toBe("2026-04-30T23:59:59.999Z");
  });
  it("shifts a quarter to the next quarter", () => {
    const p = nextPeriod(
      "QUARTER",
      new Date("2026-01-01T00:00:00.000Z"),
      new Date("2026-03-31T23:59:59.999Z"),
    );
    expect(p.start.toISOString()).toBe("2026-04-01T00:00:00.000Z");
    expect(p.end.toISOString()).toBe("2026-06-30T23:59:59.999Z");
  });
  it("shifts a year to the next year", () => {
    const p = nextPeriod(
      "YEAR",
      new Date("2026-01-01T00:00:00.000Z"),
      new Date("2026-12-31T23:59:59.999Z"),
    );
    expect(p.start.toISOString()).toBe("2027-01-01T00:00:00.000Z");
    expect(p.end.toISOString()).toBe("2027-12-31T23:59:59.999Z");
  });
  it("shifts WEEK/CUSTOM by the window length (+1 day) preserving span", () => {
    const p = nextPeriod(
      "WEEK",
      new Date("2026-03-02T00:00:00.000Z"),
      new Date("2026-03-08T23:59:59.999Z"),
    );
    expect(p.start.toISOString()).toBe("2026-03-09T00:00:00.000Z");
    expect(p.end.toISOString()).toBe("2026-03-15T23:59:59.999Z");
  });
  it("shifts a MONTH with non-calendar bounds by its span (no gap/overlap)", () => {
    // 15 Jan – 14 Feb (31-day window) is not a calendar month → span-preserving.
    const p = nextPeriod(
      "MONTH",
      new Date("2026-01-15T00:00:00.000Z"),
      new Date("2026-02-14T23:59:59.999Z"),
    );
    expect(p.start.toISOString()).toBe("2026-02-15T00:00:00.000Z");
    expect(p.end.toISOString()).toBe("2026-03-17T23:59:59.999Z");
  });
});

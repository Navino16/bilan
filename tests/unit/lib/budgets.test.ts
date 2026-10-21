import { describe, it, expect } from "vitest";
import {
  budgetPlannedTotal,
  groupBudgetSeries,
  lineStatus,
  nextPeriod,
  periodEndFor,
} from "@/lib/budgets";
import { parseAmount } from "@/lib/amount";
import { budgetLineSchema } from "@/lib/schemas/budget";

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
  it("is WARN from 80% up to just below planned", () => {
    expect(lineStatus(100, 80).status).toBe("WARN");
    expect(lineStatus(100, 99.6)).toMatchObject({ percent: 99, status: "WARN" });
    expect(lineStatus(100, 99.99)).toMatchObject({ percent: 99, status: "WARN" });
  });
  it("keeps the displayed percent in line with the status (#255)", () => {
    expect(lineStatus(100, 79.6)).toMatchObject({ percent: 79, status: "OK" });
    expect(lineStatus(100, 99.996)).toMatchObject({ percent: 100, status: "REACHED" });
    expect(lineStatus(100, 100.004)).toMatchObject({ percent: 100, status: "REACHED" });
    expect(lineStatus(100, 100.01)).toMatchObject({ percent: 101, status: "OVER" });
    expect(lineStatus(100, 100.4)).toMatchObject({ percent: 101, status: "OVER" });
  });
  it("is REACHED when spent equals planned (#230)", () => {
    expect(lineStatus(100, 100)).toMatchObject({ remaining: 0, percent: 100, status: "REACHED" });
    expect(lineStatus(0.1 + 0.2, 0.3).status).toBe("REACHED");
    expect(lineStatus(100, 100.01).status).toBe("OVER");
  });
  it("is OVER above planned", () => {
    const s = lineStatus(100, 120);
    expect(s.status).toBe("OVER");
    expect(s.remaining).toBe(-20);
    expect(s.percent).toBe(120);
  });
  it("has no percent when spending against a zero planned amount", () => {
    expect(lineStatus(0, 10)).toEqual({
      plannedAmount: 0,
      spent: 10,
      remaining: -10,
      percent: null,
      status: "OVER",
    });
    expect(lineStatus(0, 0.01)).toMatchObject({ percent: null, status: "OVER" });
  });
  it("is OK at 0% with a zero planned amount and no spending", () => {
    expect(lineStatus(0, 0)).toMatchObject({ remaining: 0, percent: 0, status: "OK" });
    expect(lineStatus(0, 0.004)).toMatchObject({ percent: 0, status: "OK" });
    expect(lineStatus(0, -5)).toMatchObject({ percent: 0, status: "OK" });
    expect(lineStatus(0.004, 0)).toMatchObject({ percent: 0, status: "OK" });
    expect(lineStatus(0.004, 1)).toMatchObject({ percent: null, status: "OVER" });
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
  it("rolls a MONTH with non-calendar bounds to the next month without drifting", () => {
    const p = nextPeriod(
      "MONTH",
      new Date("2026-01-15T00:00:00.000Z"),
      new Date("2026-02-14T23:59:59.999Z"),
    );
    expect(p.start.toISOString()).toBe("2026-02-15T00:00:00.000Z");
    expect(p.end.toISOString()).toBe("2026-03-14T23:59:59.999Z");
  });
  it("shifts CUSTOM by the window length", () => {
    const p = nextPeriod(
      "CUSTOM",
      new Date("2026-03-01T00:00:00.000Z"),
      new Date("2026-03-10T23:59:59.999Z"),
    );
    expect(p.start.toISOString()).toBe("2026-03-11T00:00:00.000Z");
    expect(p.end.toISOString()).toBe("2026-03-20T23:59:59.999Z");
  });
});

describe("periodEndFor", () => {
  it("derives the end of typed periods", () => {
    expect(periodEndFor("WEEK", "2026-03-02")).toBe("2026-03-08");
    expect(periodEndFor("MONTH", "2026-03-01")).toBe("2026-03-31");
    expect(periodEndFor("MONTH", "2026-03-15")).toBe("2026-04-14");
    expect(periodEndFor("MONTH", "2026-01-31")).toBe("2026-02-28");
    expect(periodEndFor("MONTH", "2026-01-28")).toBe("2026-02-27");
    expect(periodEndFor("QUARTER", "2026-01-01")).toBe("2026-03-31");
    expect(periodEndFor("YEAR", "2025-12-01")).toBe("2026-11-30");
  });

  it("is null for CUSTOM or an invalid date", () => {
    expect(periodEndFor("CUSTOM", "2026-03-01")).toBeNull();
    expect(periodEndFor("MONTH", "2026-02-30")).toBeNull();
    expect(periodEndFor("MONTH", "")).toBeNull();
  });
});

describe("parseAmount / budget line amount", () => {
  it("accepts a decimal comma and grouping spaces", () => {
    expect(parseAmount("300,5")).toBe(300.5);
    expect(parseAmount("1\u202f234,56")).toBe(1234.56);
    expect(parseAmount("12.5")).toBe(12.5);
    expect(parseAmount("")).toBeNaN();
  });

  it("stores 300,5 as 300.5, not 3005", () => {
    expect(budgetLineSchema.parse({ plannedAmount: "300,5" }).plannedAmount).toBe(300.5);
    expect(budgetLineSchema.safeParse({ plannedAmount: "abc" }).success).toBe(false);
    expect(budgetLineSchema.safeParse({ plannedAmount: "-1" }).success).toBe(false);
  });
});

describe("groupBudgetSeries", () => {
  const b = (
    id: string,
    parent: string | null,
    start: string,
    started: boolean,
    ended: boolean,
  ) => ({
    id,
    parentBudgetId: parent,
    periodStart: new Date(start),
    started,
    ended,
  });

  it("puts the period in progress first and the rest of the series under it", () => {
    const groups = groupBudgetSeries([
      b("sep", "aug", "2026-09-01", true, true),
      b("aug", null, "2026-08-01", true, true),
      b("oct", "aug", "2026-10-01", true, false),
      b("solo", null, "2026-07-01", true, true),
    ]);
    expect(groups.map((g) => [g.head.id, g.others.map((o) => o.id)])).toEqual([
      ["oct", ["sep", "aug"]],
      ["solo", []],
    ]);
  });

  it("falls back to the latest started period, then to the next one to come", () => {
    expect(
      groupBudgetSeries([
        b("a", null, "2026-08-01", true, true),
        b("c", "a", "2026-11-01", false, false),
      ])[0].head.id,
    ).toBe("a");
    expect(groupBudgetSeries([b("f", null, "2027-01-01", false, false)])[0].head.id).toBe("f");
  });
});

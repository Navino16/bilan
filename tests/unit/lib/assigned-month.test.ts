import { describe, expect, it } from "vitest";
import {
  assignedMonth,
  assignedMonthKey,
  manualPeriodDate,
  monthChoices,
  parseYearMonth,
} from "@/lib/assigned-month";

const d = (s: string) => new Date(s);

describe("manualPeriodDate", () => {
  it("moves to the 1st of another month", () => {
    expect(manualPeriodDate(d("2026-10-30T00:00:00Z"), 2026, 11)).toEqual(
      d("2026-11-01T00:00:00.000Z"),
    );
    expect(manualPeriodDate(d("2026-01-15T00:00:00Z"), 2025, 12)).toEqual(
      d("2025-12-01T00:00:00.000Z"),
    );
  });

  it("keeps the real date when the real month is picked", () => {
    expect(manualPeriodDate(d("2026-10-30T00:00:00Z"), 2026, 10)).toEqual(
      d("2026-10-30T00:00:00Z"),
    );
  });
});

describe("assignedMonth", () => {
  it("returns the month a shifted transaction counts in", () => {
    expect(assignedMonth(d("2026-10-30T00:00:00Z"), d("2026-11-01T00:00:00Z"))).toEqual({
      year: 2026,
      month: 11,
    });
    expect(assignedMonth(d("2026-12-31T00:00:00Z"), d("2027-01-01T00:00:00Z"))).toEqual({
      year: 2027,
      month: 1,
    });
  });

  it("is null when the period date stays in the real month", () => {
    expect(assignedMonth(d("2026-10-30T00:00:00Z"), d("2026-10-30T00:00:00Z"))).toBeNull();
    expect(assignedMonth(d("2026-10-30T00:00:00Z"), d("2026-10-01T00:00:00Z"))).toBeNull();
  });
});

describe("parseYearMonth", () => {
  it("reads a YYYY-MM month input", () => {
    expect(parseYearMonth("2026-11")).toEqual({ year: 2026, month: 11 });
  });

  it("rejects anything else", () => {
    for (const v of ["", "2026-13", "2026-1", "0000-01", "2026-11-01", "abc"]) {
      expect(parseYearMonth(v)).toBeNull();
    }
  });
});

describe("assignedMonthKey", () => {
  it("is YYYY-MM for a shifted transaction and empty otherwise", () => {
    expect(assignedMonthKey(d("2026-10-30T00:00:00Z"), d("2026-11-01T00:00:00Z"))).toBe("2026-11");
    expect(assignedMonthKey(d("2026-10-30T00:00:00Z"), d("2026-10-30T00:00:00Z"))).toBe("");
  });
});

describe("monthChoices", () => {
  it("offers 12 months before and after the real month, in order", () => {
    const choices = monthChoices(d("2026-10-30T00:00:00Z"), d("2026-10-30T00:00:00Z"));
    expect(choices).toHaveLength(25);
    expect(choices[0]).toEqual({ year: 2025, month: 10 });
    expect(choices[12]).toEqual({ year: 2026, month: 10 });
    expect(choices[24]).toEqual({ year: 2027, month: 10 });
  });

  it("keeps an assigned month outside that span", () => {
    const choices = monthChoices(d("2026-10-30T00:00:00Z"), d("2024-01-01T00:00:00Z"));
    expect(choices[0]).toEqual({ year: 2024, month: 1 });
    expect(choices).toHaveLength(26);
  });
});

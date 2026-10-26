import { describe, expect, it } from "vitest";
import { assignedMonth, manualPeriodDate } from "@/lib/assigned-month";

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

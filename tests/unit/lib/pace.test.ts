import { describe, it, expect } from "vitest";
import { bucketCount, bucketIndex, cumulativeSpending, paceGranularity } from "@/lib/pace";
import { monthPeriod, presetPeriod } from "@/lib/period";

const day = (d: string) => new Date(`${d}T00:00:00.000Z`);

describe("paceGranularity / bucketCount", () => {
  it("goes by day over a month and by month over a quarter or a year", () => {
    const now = day("2026-11-06");
    expect(paceGranularity(monthPeriod(2026, 2))).toBe("day");
    expect(bucketCount(monthPeriod(2026, 2), "day")).toBe(28);
    const quarter = presetPeriod("this-quarter", now);
    expect(paceGranularity(quarter)).toBe("month");
    expect(bucketCount(quarter, "month")).toBe(3);
    expect(bucketCount(presetPeriod("this-year", now), "month")).toBe(12);
  });
});

describe("bucketIndex", () => {
  it("counts days or calendar months from the start", () => {
    expect(bucketIndex(new Date("2026-03-05T18:00:00.000Z"), day("2026-03-01"), "day")).toBe(4);
    expect(bucketIndex(day("2027-01-31"), day("2026-11-01"), "month")).toBe(2);
  });
});

describe("cumulativeSpending", () => {
  const rows = [
    { amount: -10, date: day("2026-03-01") },
    { amount: 500, date: day("2026-03-02") },
    { amount: -30, date: day("2026-03-03") },
    { amount: -5, date: day("2026-03-09") },
  ];
  const indexOf = (d: Date) => bucketIndex(d, day("2026-03-01"), "day");

  it("sums spending only, bucket after bucket", () => {
    expect(cumulativeSpending(rows, indexOf, 4)).toEqual([10, 10, 40, 45]);
  });

  it("weighs each row and clamps rows past the last bucket onto it", () => {
    expect(cumulativeSpending(rows, indexOf, 3, 1 / 3)).toEqual([3.33, 3.33, 15]);
  });
});

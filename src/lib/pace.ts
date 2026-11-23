import { round2 } from "@/lib/budgets";
import type { Period } from "@/lib/period";

export type PaceGranularity = "day" | "month";

// Cumulative spending per bucket. `current` stops at the bucket of `asOf` while the period is in
// progress; `reference` covers the whole reference side, null when it holds no data.
export type SpendingPace = {
  granularity: PaceGranularity;
  start: string;
  buckets: number;
  asOf: string;
  current: number[];
  reference: number[] | null;
};

const DAY = 86_400_000;
// Above this span a daily curve gets unreadable: quarters and years go by month.
const DAILY_MAX_DAYS = 45;

const monthIndex = (d: Date) => d.getUTCFullYear() * 12 + d.getUTCMonth();

export function paceGranularity(period: Period): PaceGranularity {
  const days = Math.round((period.to.getTime() - period.from.getTime() + 1) / DAY);
  return days > DAILY_MAX_DAYS ? "month" : "day";
}

// Bucket of `date` counted from `start`: days, or calendar months.
export function bucketIndex(date: Date, start: Date, granularity: PaceGranularity): number {
  return granularity === "day"
    ? Math.floor((date.getTime() - start.getTime()) / DAY)
    : monthIndex(date) - monthIndex(start);
}

export function bucketCount(period: Period, granularity: PaceGranularity): number {
  return bucketIndex(period.to, period.from, granularity) + 1;
}

// Rows outside the buckets land on the nearest one, so the last point always holds the total.
export function cumulativeSpending(
  rows: { amount: number; date: Date }[],
  indexOf: (date: Date) => number,
  buckets: number,
  weight = 1,
): number[] {
  const spent = Array.from({ length: buckets }, () => 0);
  for (const r of rows) {
    if (r.amount >= 0) continue;
    const i = Math.min(Math.max(indexOf(r.date), 0), buckets - 1);
    spent[i] -= r.amount * weight;
  }
  let total = 0;
  return spent.map((v) => {
    total += v;
    return round2(total);
  });
}

import { describe, it, expect } from "vitest";
import { recentSeriesPeriods, seriesSummary, type HistoryPeriod } from "@/lib/budget-history";
import type { BudgetStatus } from "@/lib/budgets";

const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const month = (id: string, parent: string | null, m: number) => ({
  id,
  parentBudgetId: parent,
  periodStart: new Date(Date.UTC(2026, m - 1, 1)),
  periodEnd: new Date(Date.UTC(2026, m, 0, 23, 59, 59, 999)),
});

describe("recentSeriesPeriods", () => {
  const now = day("2026-06-15");

  it("groups a template and its instances, oldest first, leaving out periods to come", () => {
    const series = recentSeriesPeriods(
      [month("may", "t", 5), month("t", null, 3), month("jul", "t", 7), month("jun", "t", 6)],
      now,
    );
    expect(series.map((s) => s.map((b) => b.id))).toEqual([["t", "may", "jun"]]);
  });

  it("keeps the latest periods up to the limit", () => {
    const budgets = [month("t", null, 1), ...[2, 3, 4, 5, 6].map((m) => month(`m${m}`, "t", m))];
    expect(recentSeriesPeriods(budgets, now, 3).map((s) => s.map((b) => b.id))).toEqual([
      ["m4", "m5", "m6"],
    ]);
  });

  it("needs two finished periods in a series", () => {
    const series = recentSeriesPeriods(
      [
        month("lone", null, 4),
        month("a", null, 5),
        month("a6", "a", 6),
        month("b", null, 4),
        month("b5", "b", 5),
      ],
      now,
    );
    expect(series.map((s) => s.map((b) => b.id))).toEqual([["b", "b5"]]);
  });

  it("orders series by their latest period, newest first", () => {
    const series = recentSeriesPeriods(
      [
        month("old", null, 1),
        month("old2", "old", 2),
        month("new", null, 4),
        month("new5", "new", 5),
        month("new6", "new", 6),
      ],
      now,
    );
    expect(series.map((s) => s[0].id)).toEqual(["new", "old"]);
  });
});

describe("seriesSummary", () => {
  const period = (
    planned: number,
    spent: number,
    status: BudgetStatus,
    inProgress = false,
  ): HistoryPeriod => ({
    id: `${planned}-${spent}`,
    periodStart: day("2026-01-01"),
    periodEnd: day("2026-01-31"),
    planned,
    spent,
    percent: null,
    status,
    inProgress,
  });

  it("counts the finished periods over and averages their signed gap", () => {
    expect(
      seriesSummary([
        period(100, 130, "OVER"),
        period(100, 80, "WARN"),
        period(100, 100, "REACHED"),
        period(100, 160.5, "OVER"),
        period(100, 500, "OVER", true),
      ]),
    ).toEqual({ finished: 4, over: 2, averageGap: 17.63 });
  });

  it("reads an underspending series as a negative gap", () => {
    expect(seriesSummary([period(200, 150, "OK"), period(200, 170, "OK")])).toEqual({
      finished: 2,
      over: 0,
      averageGap: -40,
    });
  });

  it("has no gap without a finished period", () => {
    expect(seriesSummary([period(100, 120, "OVER", true)])).toEqual({
      finished: 0,
      over: 0,
      averageGap: 0,
    });
  });
});

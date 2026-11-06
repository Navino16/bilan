import { round2, type BudgetStatus } from "@/lib/budgets";

export const HISTORY_PERIODS = 12;
const MIN_FINISHED = 2;

type SeriesBudget = {
  id: string;
  parentBudgetId: string | null;
  periodStart: Date;
  periodEnd: Date;
};

// The latest started periods of each series (spec §5.17), oldest first, keeping the series
// with at least two finished periods among them. Newest series first.
export function recentSeriesPeriods<T extends SeriesBudget>(
  budgets: T[],
  now: Date,
  limit = HISTORY_PERIODS,
): T[][] {
  const bySeries = new Map<string, T[]>();
  for (const b of budgets) {
    if (b.periodStart > now) continue;
    const key = b.parentBudgetId ?? b.id;
    bySeries.set(key, [...(bySeries.get(key) ?? []), b]);
  }
  return [...bySeries.values()]
    .map((members) =>
      members.sort((a, b) => a.periodStart.getTime() - b.periodStart.getTime()).slice(-limit),
    )
    .filter((periods) => periods.filter((b) => b.periodEnd < now).length >= MIN_FINISHED)
    .sort((a, b) => b[b.length - 1].periodStart.getTime() - a[a.length - 1].periodStart.getTime());
}

export type HistoryPeriod = {
  id: string;
  periodStart: Date;
  periodEnd: Date;
  planned: number;
  spent: number;
  percent: number | null;
  status: BudgetStatus;
  inProgress: boolean;
};

export type SeriesSummary = {
  finished: number;
  over: number;
  // Mean of spent − planned over the finished periods: above zero, the series overspends.
  averageGap: number;
};

export function seriesSummary(periods: HistoryPeriod[]): SeriesSummary {
  const finished = periods.filter((p) => !p.inProgress);
  const gap = finished.reduce((s, p) => s + p.spent - p.planned, 0);
  return {
    finished: finished.length,
    over: finished.filter((p) => p.status === "OVER").length,
    averageGap: finished.length === 0 ? 0 : round2(gap / finished.length),
  };
}

export type BudgetSeriesHistory = SeriesSummary & {
  // The latest period's id and name stand for the series.
  id: string;
  name: string;
  group: boolean;
  periods: HistoryPeriod[];
};

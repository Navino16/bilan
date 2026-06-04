// A reporting window. `year`/`month` (1-12) are set only when the window is a
// whole calendar month (enables month navigation + a "vs previous month" delta);
// for custom ranges they are null. All bounds are UTC and inclusive.
export type Period = {
  from: Date;
  to: Date;
  year: number | null;
  month: number | null;
};

const daysInMonth = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).getUTCDate();

// Whole calendar month, month is 1-12.
export function monthPeriod(year: number, month: number): Period {
  const last = daysInMonth(year, month);
  return {
    from: new Date(Date.UTC(year, month - 1, 1, 0, 0, 0, 0)),
    to: new Date(Date.UTC(year, month - 1, last, 23, 59, 59, 999)),
    year,
    month,
  };
}

// Shifts a {year, month} by `delta` months, wrapping the year.
export function addMonths(year: number, month: number, delta: number): { year: number; month: number } {
  const zero = year * 12 + (month - 1) + delta;
  return { year: Math.floor(zero / 12), month: (((zero % 12) + 12) % 12) + 1 };
}

// The calendar month before a month period (for the "vs previous" delta).
export function previousMonthPeriod(p: Period): Period {
  const y = p.year ?? p.from.getUTCFullYear();
  const m = p.month ?? p.from.getUTCMonth() + 1;
  const prev = addMonths(y, m, -1);
  return monthPeriod(prev.year, prev.month);
}

// Inclusive UTC bounds for an arbitrary ISO-day range.
function customPeriod(fromDay: string, toDay: string): Period {
  return {
    from: new Date(`${fromDay}T00:00:00.000Z`),
    to: new Date(`${toDay}T23:59:59.999Z`),
    year: null,
    month: null,
  };
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

// Resolves the active period from URL params. `?from`/`?to` (ISO days) define a
// custom range; otherwise fall back to `fallbackMonth` (defaults to "now" UTC).
export function parsePeriodParams(
  params: { from?: string; to?: string },
  fallbackMonth?: { year: number; month: number },
): Period {
  const { from, to } = params;
  if (from && to && ISO_DAY.test(from) && ISO_DAY.test(to) && from <= to) {
    return customPeriod(from, to);
  }
  const now = new Date();
  const fb = fallbackMonth ?? { year: now.getUTCFullYear(), month: now.getUTCMonth() + 1 };
  return monthPeriod(fb.year, fb.month);
}

// ISO day (YYYY-MM-DD) of a date's UTC calendar day — for building ?from/?to links.
export function toIsoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// "Mai 2026" — localized month + year label for a month period.
export function formatMonthLabel(p: Period, locale: string): string {
  const d = p.year && p.month ? new Date(Date.UTC(p.year, p.month - 1, 1)) : p.from;
  return new Intl.DateTimeFormat(locale, { month: "long", year: "numeric", timeZone: "UTC" }).format(d);
}

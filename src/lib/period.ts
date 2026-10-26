import { formatDateRange, formatMonthRange, formatMonthYear } from "./format";

// A reporting window. `year`/`month` (1-12) are set only when the window is a
// whole calendar month (enables month navigation + a "vs previous month" delta);
// for custom ranges they are null. All bounds are UTC and inclusive.
export type Period = {
  from: Date;
  to: Date;
  year: number | null;
  month: number | null;
};

const daysInMonth = (year: number, month: number) =>
  new Date(Date.UTC(year, month, 0)).getUTCDate();

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
export function addMonths(
  year: number,
  month: number,
  delta: number,
): { year: number; month: number } {
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
export const dayStart = (day: string) => new Date(`${day}T00:00:00.000Z`);
export const dayEnd = (day: string) => new Date(`${day}T23:59:59.999Z`);

function customPeriod(fromDay: string, toDay: string): Period {
  return {
    from: dayStart(fromDay),
    to: dayEnd(toDay),
    year: null,
    month: null,
  };
}

const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;
const MIN_YEAR = 1970;
const MAX_YEAR = 2100;
// Longer chart windows are cut: charts and aggregates stop making sense (and get slow).
const MAX_RANGE_YEARS = 10;

// A real calendar day in a sane year range ("2026-02-30", "2026-13-45" and
// "0000-01-01" are rejected rather than rolled over).
export function isValidIsoDay(day: string | undefined): day is string {
  const m = day ? ISO_DAY.exec(day) : null;
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  return y >= MIN_YEAR && y <= MAX_YEAR && mo >= 1 && mo <= 12 && d >= 1 && d <= daysInMonth(y, mo);
}

// A range covering exactly one calendar month (1st → last day) is treated as a
// month period so `year`/`month` are set and month nav keeps stepping correctly
// (otherwise the round-trip through ?from/?to loses the month and nav falls back
// to "now"). Returns null for any other range.
function wholeMonthOf(fromDay: string, toDay: string): Period | null {
  const [fy, fm, fd] = fromDay.split("-").map(Number);
  const [ty, tm, td] = toDay.split("-").map(Number);
  if (fd !== 1 || fy !== ty || fm !== tm) return null;
  if (td !== daysInMonth(fy, fm)) return null;
  return monthPeriod(fy, fm);
}

// The valid `?from`/`?to` days, in order; an invalid one is dropped (open bound).
export function parseDayBounds(params: { from?: string; to?: string }): {
  from?: string;
  to?: string;
} {
  const from = isValidIsoDay(params.from) ? params.from : undefined;
  const to = isValidIsoDay(params.to) ? params.to : undefined;
  return from && to && from > to ? { from: to, to: from } : { from, to };
}

// A chart window needs both ends: a lone `from` runs to today (or that day if
// later), a lone `to` starts on the 1st of its month, and the span is capped by
// moving `from` so the most recent part stays. Null when no bound is valid.
export function parseRangeParams(
  params: { from?: string; to?: string },
  now: Date = new Date(),
): Period | null {
  let { from, to } = parseDayBounds(params);
  if (!from && !to) return null;
  if (from && !to) to = from > toIsoDay(now) ? from : toIsoDay(now);
  if (!from) from = `${to!.slice(0, 8)}01`;
  const floor = new Date(`${to}T00:00:00.000Z`);
  floor.setUTCFullYear(floor.getUTCFullYear() - MAX_RANGE_YEARS);
  floor.setUTCDate(floor.getUTCDate() + 1);
  if (from < toIsoDay(floor)) from = toIsoDay(floor);
  return wholeMonthOf(from, to!) ?? customPeriod(from, to!);
}

// Resolves the active period from URL params: the requested range, else
// `fallbackMonth` (defaults to the current UTC month).
export function parsePeriodParams(
  params: { from?: string; to?: string },
  fallbackMonth?: { year: number; month: number },
  now: Date = new Date(),
): Period {
  const range = parseRangeParams(params, now);
  if (range) return range;
  const fb = fallbackMonth ?? { year: now.getUTCFullYear(), month: now.getUTCMonth() + 1 };
  return monthPeriod(fb.year, fb.month);
}

// The last instant one may browse: the end of next month, which can already hold
// transactions assigned to it (#341).
export function nextMonthEnd(now: Date = new Date()): Date {
  const next = addMonths(now.getUTCFullYear(), now.getUTCMonth() + 1, 1);
  return monthPeriod(next.year, next.month).to;
}

// Guards against browsing a window starting after next month (a direct URL to e.g.
// ?from=2099-01-01): it snaps back to the current month.
// A period that merely extends into the future — the current year or quarter,
// whose later months simply haven't happened yet — is kept intact so its label
// and granularity-aware navigation stay correct (its future months render empty).
export function clampPeriodToNow(p: Period, now: Date = new Date()): Period {
  if (p.from.getTime() > nextMonthEnd(now).getTime()) {
    return monthPeriod(now.getUTCFullYear(), now.getUTCMonth() + 1);
  }
  return p;
}

export function periodUpcoming(p: Period, now: Date = new Date()): boolean {
  return p.from.getTime() > now.getTime();
}

export function currentUtcYear(now: Date = new Date()): number {
  return now.getUTCFullYear();
}

// True while `now` falls inside the period: its comparison with the full previous
// period is then partial.
export function periodInProgress(p: Period, now: Date = new Date()): boolean {
  return p.from.getTime() <= now.getTime() && now.getTime() <= p.to.getTime();
}

// The `count` calendar months (oldest first) ending at the period's last month,
// capped at the current month so a year or quarter never ends in the future.
export function historyMonths(
  p: Period,
  count: number,
  now: Date = new Date(),
): { year: number; month: number }[] {
  const endZero = Math.min(
    p.to.getUTCFullYear() * 12 + p.to.getUTCMonth(),
    now.getUTCFullYear() * 12 + now.getUTCMonth(),
  );
  const end = { year: Math.floor(endZero / 12), month: (endZero % 12) + 1 };
  return Array.from({ length: count }, (_, i) => addMonths(end.year, end.month, i - count + 1));
}

// The whole-month range covering `months` (oldest first).
export function monthsSpan(months: { year: number; month: number }[]): Period {
  const first = months[0];
  const last = months[months.length - 1];
  return {
    from: monthPeriod(first.year, first.month).from,
    to: monthPeriod(last.year, last.month).to,
    year: null,
    month: null,
  };
}

export const BASELINES = ["prev", "avg3", "avg6", "avg12"] as const;
export type Baseline = (typeof BASELINES)[number];

// Averages only make sense against whole months: other periods fall back to "prev".
export function parseBaseline(value: string | undefined, p: Period): Baseline {
  if (!p.month || !BASELINES.includes(value as Baseline)) return "prev";
  return value as Baseline;
}

export type Comparison = {
  baseline: Baseline;
  // Days elapsed while the period is in progress: the reference side is cut to that many days.
  elapsedDays: number | null;
  previous: Period;
  // The months averaged, oldest first (empty for "prev").
  months: { year: number; month: number }[];
  // Not started yet: only transactions assigned to it show (#341).
  upcoming: boolean;
};

function truncatePeriod(p: Period, days: number): Period {
  const end = new Date(p.from.getTime() + days * 86_400_000 - 1);
  return end < p.to ? { from: p.from, to: end, year: null, month: null } : p;
}

export function comparisonFor(
  period: Period,
  baseline: Baseline,
  now: Date = new Date(),
): Comparison {
  const elapsedDays = periodInProgress(period, now)
    ? Math.floor((now.getTime() - period.from.getTime()) / 86_400_000) + 1
    : null;
  const cut = (p: Period) => (elapsedDays ? truncatePeriod(p, elapsedDays) : p);
  const count = baseline === "prev" ? 0 : Number(baseline.slice(3));
  return {
    baseline,
    elapsedDays,
    previous: cut(previousPeriod(period)),
    months: count ? historyMonths(previousMonthPeriod(period), count, now) : [],
    upcoming: periodUpcoming(period, now),
  };
}

// ISO day (YYYY-MM-DD) of a date's UTC calendar day — for building ?from/?to links.
export function toIsoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// "Mai 2026" — localized month + year label for a month period.
function formatMonthLabel(p: Period, locale: string): string {
  const d = p.year && p.month ? new Date(Date.UTC(p.year, p.month - 1, 1)) : p.from;
  return formatMonthYear(d, locale);
}

const capitalize = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

// A clear, compact header label for any period:
// month → "Mai 2026", whole year → "2026", a range spanning whole months
// (e.g. a quarter) → "avr. – juin 2026", anything else → "10–30 avr. 2026".
export function formatPeriodLabel(p: Period, locale: string): string {
  if (p.year && p.month) return capitalize(formatMonthLabel(p, locale));

  const fy = p.from.getUTCFullYear();
  const ty = p.to.getUTCFullYear();
  const fm = p.from.getUTCMonth(); // 0-based
  const tm = p.to.getUTCMonth();
  const fd = p.from.getUTCDate();
  const td = p.to.getUTCDate();

  // Whole calendar year → "2026".
  if (fy === ty && fm === 0 && fd === 1 && tm === 11 && td === 31) return String(fy);

  // A range spanning whole months (1st → last day), e.g. a quarter → a month
  // range so it's clear from when to when, without redundant day numbers.
  if (fd === 1 && td === daysInMonth(ty, tm + 1)) {
    return formatMonthRange(p.from, p.to, locale);
  }

  // Arbitrary range — Intl collapses the shared parts ("10–30 avr. 2026").
  return formatDateRange(p.from, p.to, locale);
}

export const PERIOD_PRESETS = ["this-month", "last-month", "this-quarter", "this-year"] as const;
export type PeriodPreset = (typeof PERIOD_PRESETS)[number];

// A preset window relative to `now` (UTC). Month presets carry year/month;
// quarter/year are custom (month = null).
export function presetPeriod(preset: PeriodPreset, now: Date = new Date()): Period {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth() + 1;
  switch (preset) {
    case "this-month":
      return monthPeriod(y, m);
    case "last-month": {
      const p = addMonths(y, m, -1);
      return monthPeriod(p.year, p.month);
    }
    case "this-quarter": {
      const startMonth = Math.floor((m - 1) / 3) * 3 + 1;
      const lastDay = daysInMonth(y, startMonth + 2);
      return {
        from: new Date(Date.UTC(y, startMonth - 1, 1, 0, 0, 0, 0)),
        to: new Date(Date.UTC(y, startMonth + 1, lastDay, 23, 59, 59, 999)),
        year: null,
        month: null,
      };
    }
    case "this-year":
      return {
        from: new Date(Date.UTC(y, 0, 1, 0, 0, 0, 0)),
        to: new Date(Date.UTC(y, 11, 31, 23, 59, 59, 999)),
        year: null,
        month: null,
      };
  }
}

// The window immediately before `p`, for the "vs previous" delta. Stepping back
// by one unit of the period's own granularity keeps calendar windows aligned:
// the previous month/quarter/year (not a fixed day count, which would drift a
// quarter onto the wrong boundary and a year across a leap-year boundary). For
// an arbitrary range this is still the same-length window ending the day before.
export function previousPeriod(p: Period): Period {
  return shiftPeriod(p, -1);
}

// Builds a whole quarter from its 1-based start month.
function quarterFrom(year: number, startMonth: number): Period {
  const lastDay = daysInMonth(year, startMonth + 2);
  return {
    from: new Date(Date.UTC(year, startMonth - 1, 1, 0, 0, 0, 0)),
    to: new Date(Date.UTC(year, startMonth + 1, lastDay, 23, 59, 59, 999)),
    year: null,
    month: null,
  };
}

// Steps a period by one unit of ITS OWN granularity (so the dashboard arrows
// move month-by-month on a month, quarter-by-quarter on a quarter, year-by-year
// on a year, and by the window length on an arbitrary range).
export function shiftPeriod(p: Period, dir: 1 | -1): Period {
  if (p.year && p.month) {
    const m = addMonths(p.year, p.month, dir);
    return monthPeriod(m.year, m.month);
  }

  const fy = p.from.getUTCFullYear();
  const ty = p.to.getUTCFullYear();
  const fm = p.from.getUTCMonth(); // 0-based
  const tm = p.to.getUTCMonth();
  const fd = p.from.getUTCDate();
  const td = p.to.getUTCDate();

  // Whole year → previous/next year.
  if (fy === ty && fm === 0 && fd === 1 && tm === 11 && td === 31) {
    const y = fy + dir;
    return {
      from: new Date(Date.UTC(y, 0, 1, 0, 0, 0, 0)),
      to: new Date(Date.UTC(y, 11, 31, 23, 59, 59, 999)),
      year: null,
      month: null,
    };
  }

  // Whole quarter → previous/next quarter (kept aligned to Jan/Apr/Jul/Oct).
  if (fy === ty && fm % 3 === 0 && fd === 1 && tm === fm + 2 && td === daysInMonth(ty, tm + 1)) {
    const start = addMonths(fy, fm + 1, dir * 3);
    return quarterFrom(start.year, start.month);
  }

  // Arbitrary range → shift both bounds by the window length.
  const dayMs = 86_400_000;
  const lengthDays = Math.round((p.to.getTime() - p.from.getTime() + 1) / dayMs);
  const from = new Date(p.from.getTime() + dir * lengthDays * dayMs);
  const to = new Date(p.to.getTime() + dir * lengthDays * dayMs);
  return {
    from: new Date(`${toIsoDay(from)}T00:00:00.000Z`),
    to: new Date(`${toIsoDay(to)}T23:59:59.999Z`),
    year: null,
    month: null,
  };
}

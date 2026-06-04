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
function customPeriod(fromDay: string, toDay: string): Period {
  return {
    from: new Date(`${fromDay}T00:00:00.000Z`),
    to: new Date(`${toDay}T23:59:59.999Z`),
    year: null,
    month: null,
  };
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

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

// Resolves the active period from URL params. `?from`/`?to` (ISO days) define a
// custom range; otherwise fall back to `fallbackMonth` (defaults to "now" UTC).
export function parsePeriodParams(
  params: { from?: string; to?: string },
  fallbackMonth?: { year: number; month: number },
): Period {
  const { from, to } = params;
  if (from && to && ISO_DAY.test(from) && ISO_DAY.test(to) && from <= to) {
    return wholeMonthOf(from, to) ?? customPeriod(from, to);
  }
  const now = new Date();
  const fb = fallbackMonth ?? { year: now.getUTCFullYear(), month: now.getUTCMonth() + 1 };
  return monthPeriod(fb.year, fb.month);
}

// Clamps a period so it never extends past the current month — a direct URL to a
// future range (e.g. ?from=2027-01-01) snaps back, since there's no future data
// to show. A fully-future window resets to the current month; one that merely
// spills over has its upper bound trimmed to the end of the current month.
export function clampPeriodToNow(p: Period, now: Date = new Date()): Period {
  const current = monthPeriod(now.getUTCFullYear(), now.getUTCMonth() + 1);
  if (p.from.getTime() > current.to.getTime()) return current;
  if (p.to.getTime() > current.to.getTime()) {
    return { from: p.from, to: current.to, year: null, month: null };
  }
  return p;
}

// ISO day (YYYY-MM-DD) of a date's UTC calendar day — for building ?from/?to links.
export function toIsoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// "Mai 2026" — localized month + year label for a month period.
export function formatMonthLabel(p: Period, locale: string): string {
  const d = p.year && p.month ? new Date(Date.UTC(p.year, p.month - 1, 1)) : p.from;
  return new Intl.DateTimeFormat(locale, {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(d);
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
    return new Intl.DateTimeFormat(locale, {
      month: "short",
      year: "numeric",
      timeZone: "UTC",
    }).formatRange(p.from, p.to);
  }

  // Arbitrary range — Intl collapses the shared parts ("10–30 avr. 2026").
  return new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).formatRange(p.from, p.to);
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

// Same-length window immediately before `p` (for the custom-range delta).
export function previousPeriod(p: Period): Period {
  if (p.year && p.month) return previousMonthPeriod(p);
  const dayMs = 86_400_000;
  const lengthDays = Math.round((p.to.getTime() - p.from.getTime() + 1) / dayMs);
  const toDay = new Date(p.from.getTime() - dayMs);
  const fromDay = new Date(toDay.getTime() - (lengthDays - 1) * dayMs);
  return {
    from: new Date(`${toIsoDay(fromDay)}T00:00:00.000Z`),
    to: new Date(`${toIsoDay(toDay)}T23:59:59.999Z`),
    year: null,
    month: null,
  };
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

// Assigned month of a transaction (#341): `periodDate` is `date`, or the 1st of
// another month the transaction counts toward. All dates are UTC.

export const SHIFT_DAYS_MIN = 1;
export const SHIFT_DAYS_MAX = 15;

export type YearMonth = { year: number; month: number };

function sameMonth(a: Date, year: number, month: number): boolean {
  return a.getUTCFullYear() === year && a.getUTCMonth() + 1 === month;
}

// Picking the real month pins the transaction to its own date.
export function manualPeriodDate(date: Date, year: number, month: number): Date {
  if (sameMonth(date, year, month)) return date;
  const first = new Date(0);
  first.setUTCFullYear(year, month - 1, 1);
  return first;
}

export function assignedMonth(date: Date, periodDate: Date): YearMonth | null {
  const year = periodDate.getUTCFullYear();
  const month = periodDate.getUTCMonth() + 1;
  return sameMonth(date, year, month) ? null : { year, month };
}

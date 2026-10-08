// Shared locale-aware formatters (#169). Pure and client-safe.

type DateInput = Date | string | number;

const toDate = (v: DateInput) => (v instanceof Date ? v : new Date(v));

const dateFormats = new Map<string, Intl.DateTimeFormat>();
const numberFormats = new Map<string, Intl.NumberFormat>();

function dateFormat(
  kind: string,
  locale: string,
  timeZone: string | undefined,
  options: Intl.DateTimeFormatOptions,
): Intl.DateTimeFormat {
  const key = `${kind}|${locale}|${timeZone ?? ""}`;
  let f = dateFormats.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat(locale, { ...options, timeZone });
    dateFormats.set(key, f);
  }
  return f;
}

function numberFormat(
  kind: string,
  locale: string,
  options: Intl.NumberFormatOptions,
): Intl.NumberFormat {
  const key = `${kind}|${locale}`;
  let f = numberFormats.get(key);
  if (!f) {
    f = new Intl.NumberFormat(locale, options);
    numberFormats.set(key, f);
  }
  return f;
}

// Calendar days are stored at UTC midnight, so date-only values format in UTC by
// default: the SSR pass and every viewer's zone then show the same day.
export function formatDate(value: DateInput, locale: string, timeZone = "UTC"): string {
  return dateFormat("date", locale, timeZone, { dateStyle: "medium" }).format(toDate(value));
}

// An instant: `timeZone` undefined = the runtime's zone (the viewer's, in the browser).
export function formatDateTime(
  value: DateInput,
  locale: string,
  { timeZone, seconds = false }: { timeZone?: string; seconds?: boolean } = {},
): string {
  return dateFormat(seconds ? "datetime-s" : "datetime", locale, timeZone, {
    dateStyle: "medium",
    timeStyle: seconds ? "medium" : "short",
  }).format(toDate(value));
}

export function formatDateRange(from: DateInput, to: DateInput, locale: string): string {
  return dateFormat("date", locale, "UTC", { dateStyle: "medium" }).formatRange(
    toDate(from),
    toDate(to),
  );
}

// Compact "1 oct." / "Oct 1" for lists and charts where the year is implied.
export function formatDayMonth(value: DateInput, locale: string): string {
  return dateFormat("daymonth", locale, "UTC", { day: "numeric", month: "short" }).format(
    toDate(value),
  );
}

// `ratio` is a fraction (0.39 → "39 %" / "39%").
export function formatPercent(
  ratio: number,
  locale: string,
  { signed = false }: { signed?: boolean } = {},
): string {
  return numberFormat(signed ? "percent-signed" : "percent", locale, {
    style: "percent",
    maximumFractionDigits: 0,
    signDisplay: signed ? "exceptZero" : "auto",
  }).format(ratio);
}

export function formatCount(n: number, locale: string): string {
  return numberFormat("count", locale, {}).format(n);
}

// Intl's unit names ("ko", "kB", "byte") don't match the usual UI spelling.
const BYTE_UNITS: Record<string, readonly string[]> = {
  fr: ["o", "Ko", "Mo", "Go"],
  en: ["B", "KB", "MB", "GB"],
};

export function formatBytes(n: number, locale: string): string {
  const units = BYTE_UNITS[locale.slice(0, 2)] ?? BYTE_UNITS.en;
  let value = n;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i++;
  }
  const number = numberFormat(i === 0 ? "bytes-0" : "bytes-1", locale, {
    maximumFractionDigits: i === 0 ? 0 : 1,
  });
  return `${number.format(value)} ${units[i]}`;
}

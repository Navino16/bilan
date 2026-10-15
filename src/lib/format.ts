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

// Node's ICU and browsers disagree on thin (U+2009) and narrow no-break (U+202F) spaces in
// dates ("Oct 1 – 31", "4:03 PM"): plain spaces keep SSR and hydration identical (#226).
const ICU_SPACES = /[\u2009\u202f]/g;

// French writes the first day of a month as an ordinal: « 1er octobre ».
function joinParts(parts: Intl.DateTimeFormatPart[], locale: string): string {
  const french = locale.slice(0, 2) === "fr";
  return parts
    .map((p) => (french && p.type === "day" && p.value === "1" ? "1er" : p.value))
    .join("")
    .replace(ICU_SPACES, " ");
}

// Splits « 1er » ordinals so their suffix can be rendered outside CSS uppercase
// (« 1ER » otherwise): odd indexes hold the suffixes.
export function ordinalSegments(text: string): string[] {
  return text.split(/(?<=\b1)(er)\b/);
}

function formatWith(f: Intl.DateTimeFormat, value: DateInput, locale: string): string {
  return joinParts(f.formatToParts(toDate(value)), locale);
}

function formatRangeWith(
  f: Intl.DateTimeFormat,
  from: DateInput,
  to: DateInput,
  locale: string,
): string {
  return joinParts(f.formatRangeToParts(toDate(from), toDate(to)), locale);
}

// Calendar days are stored at UTC midnight, so date-only values format in UTC by
// default: the SSR pass and every viewer's zone then show the same day.
export function formatDate(value: DateInput, locale: string, timeZone = "UTC"): string {
  return formatWith(dateFormat("date", locale, timeZone, { dateStyle: "medium" }), value, locale);
}

// An instant: `timeZone` undefined = the runtime's zone (the viewer's, in the browser).
export function formatDateTime(
  value: DateInput,
  locale: string,
  { timeZone, seconds = false }: { timeZone?: string; seconds?: boolean } = {},
): string {
  const f = dateFormat(seconds ? "datetime-s" : "datetime", locale, timeZone, {
    dateStyle: "medium",
    timeStyle: seconds ? "medium" : "short",
  });
  return formatWith(f, value, locale);
}

export function formatDateRange(from: DateInput, to: DateInput, locale: string): string {
  const f = dateFormat("date", locale, "UTC", { dateStyle: "medium" });
  return formatRangeWith(f, from, to, locale);
}

// "avr. – juin 2026": a range of whole months.
export function formatMonthRange(from: DateInput, to: DateInput, locale: string): string {
  const f = dateFormat("month-range", locale, "UTC", { month: "short", year: "numeric" });
  return formatRangeWith(f, from, to, locale);
}

// Compact "1er oct." / "Oct 1" for lists and charts where the year is implied.
export function formatDayMonth(value: DateInput, locale: string): string {
  const f = dateFormat("daymonth", locale, "UTC", { day: "numeric", month: "short" });
  return formatWith(f, value, locale);
}

// A calendar day in full: "jeudi 1er octobre 2026" / "Thursday, October 1, 2026".
export function formatLongDay(
  value: DateInput,
  locale: string,
  { year = true }: { year?: boolean } = {},
): string {
  const f = dateFormat(year ? "longday-y" : "longday", locale, "UTC", {
    weekday: "long",
    day: "numeric",
    month: "long",
    ...(year ? { year: "numeric" } : {}),
  });
  return formatWith(f, value, locale);
}

// "mai 2026" / "May 2026"; "oct. 2026" / "Oct 2026" with `month: "short"`.
export function formatMonthYear(
  value: DateInput,
  locale: string,
  { month = "long" }: { month?: "long" | "short" } = {},
): string {
  const f = dateFormat(`month-${month}`, locale, "UTC", { month, year: "numeric" });
  return formatWith(f, value, locale);
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

// Euros, always with cents (#175: full amounts, no compact notation).
export function formatMoney(n: number, locale: string): string {
  return numberFormat("money", locale, { style: "currency", currency: "EUR" }).format(n);
}

// Value of an amount <input>: "1 234,50" / "1,234.50", read back by `readAmount`.
export function formatAmountInput(n: number, locale: string): string {
  return numberFormat("amount-input", locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
    signDisplay: "negative",
  }).format(n);
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

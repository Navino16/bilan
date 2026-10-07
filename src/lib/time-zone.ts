export function isValidTimeZone(tz: string | undefined): tz is string {
  if (!tz) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

// Offset of `tz` from UTC at instant `at`, in ms (positive east of Greenwich).
function zoneOffsetMs(at: Date, tz: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(at);
  const get = (type: string) => Number(parts.find((p) => p.type === type)!.value);
  const wall = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour"),
    get("minute"),
    get("second"),
  );
  return wall - Math.floor(at.getTime() / 1000) * 1000;
}

function localIsoDay(at: number, tz: string): string {
  return new Date(at + zoneOffsetMs(new Date(at), tz)).toISOString().slice(0, 10);
}

// The instant a calendar day (YYYY-MM-DD) starts in `tz`. The offset is re-read at
// the first guess for a DST change between UTC and local midnight; when the change
// happens at midnight itself (local midnight doesn't exist), the day starts at `guess`.
export function zonedDayStart(day: string, tz: string): Date {
  const utcMidnight = Date.parse(`${day}T00:00:00.000Z`);
  const guess = utcMidnight - zoneOffsetMs(new Date(utcMidnight), tz);
  const start = utcMidnight - zoneOffsetMs(new Date(guess), tz);
  return new Date(localIsoDay(start, tz) < day ? guess : start);
}

export function nextIsoDay(day: string): string {
  const d = new Date(`${day}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

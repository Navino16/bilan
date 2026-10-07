"use client";

import { useSyncExternalStore } from "react";
import { useLocale } from "next-intl";

const noop = () => () => {};

// The server can't know the viewer's time zone: its HTML shows the UTC day only,
// then the browser renders the date and time in its own zone.
export function LocalDateTime({ value }: { value: Date | string }) {
  const locale = useLocale();
  const inBrowser = useSyncExternalStore(
    noop,
    () => true,
    () => false,
  );
  const date = new Date(value);
  const format = inBrowser
    ? new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" })
    : new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "UTC" });
  return <time dateTime={date.toISOString()}>{format.format(date)}</time>;
}

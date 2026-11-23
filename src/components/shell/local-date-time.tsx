"use client";

import { useSyncExternalStore } from "react";
import { useLocale } from "next-intl";
import { formatDate, formatDateTime } from "@/lib/format";

const noop = () => () => {};

// The server can't know the viewer's time zone: its HTML shows the UTC day only,
// then the browser renders the date (and time unless `dateOnly`) in its own zone.
export function LocalDateTime({
  value,
  seconds = false,
  dateOnly = false,
}: {
  value: Date | string;
  seconds?: boolean;
  dateOnly?: boolean;
}) {
  const locale = useLocale();
  const inBrowser = useSyncExternalStore(
    noop,
    () => true,
    () => false,
  );
  const date = new Date(value);
  return (
    <time dateTime={date.toISOString()}>
      {inBrowser && !dateOnly
        ? formatDateTime(date, locale, { seconds })
        : formatDate(
            date,
            locale,
            inBrowser ? Intl.DateTimeFormat().resolvedOptions().timeZone : undefined,
          )}
    </time>
  );
}

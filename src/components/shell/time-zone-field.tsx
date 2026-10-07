"use client";

import { useSyncExternalStore } from "react";

const noop = () => () => {};

// Hidden form field carrying the browser's IANA time zone, so a GET filter form
// lets the server read date inputs as the viewer's local days.
export function TimeZoneField({ name = "tz" }: { name?: string }) {
  const tz = useSyncExternalStore(
    noop,
    () => Intl.DateTimeFormat().resolvedOptions().timeZone,
    () => "",
  );
  return <input type="hidden" name={name} value={tz} />;
}

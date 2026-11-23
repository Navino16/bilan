"use client";

import { useSyncExternalStore } from "react";

// Mobile viewport match, SSR-safe: hydration renders `false` (the server snapshot) and then
// switches, while a component mounted later (e.g. a dialog opened on demand) gets the real
// value on its first render. Shared by the responsive sheets/dialogs.
export const MOBILE_QUERY = "(max-width: 767px)";

let mql: MediaQueryList | undefined;
const mediaQuery = () => (mql ??= window.matchMedia(MOBILE_QUERY));

function subscribe(onChange: () => void) {
  const mq = mediaQuery();
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}

export function useIsMobile(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => mediaQuery().matches,
    () => false,
  );
}

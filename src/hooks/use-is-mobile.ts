"use client";

import { useEffect, useState } from "react";

// Resolves a mobile viewport after mount (SSR-safe: starts `false`, so it never
// causes a hydration mismatch — mobile-only UI switches on a post-hydration
// media-query match). Shared by the transaction detail sheet and the responsive
// account/group dialogs.
export const MOBILE_QUERY = "(max-width: 767px)";

export function useIsMobile(): boolean {
  const [mobile, setMobile] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(MOBILE_QUERY);
    const sync = () => setMobile(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);
  return mobile;
}

"use client";

import { useEffect, useEffectEvent } from "react";
import { MOBILE_QUERY } from "@/hooks/use-is-mobile";

// Opens a form requested by `?new=1` once mounted (useIsMobile only resolves post-hydration,
// so the viewport is read here), then drops the param so a reload or back doesn't reopen it.
// The live URL is checked, not just `requested`: back navigation restores a tree rendered
// with the param. Next syncs history.replaceState with its router, without a server round trip.
export function useOpenFromQuery(requested: boolean, open: (mobile: boolean) => void): void {
  const onOpen = useEffectEvent(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.get("new") !== "1") return;
    open(window.matchMedia(MOBILE_QUERY).matches);
    url.searchParams.delete("new");
    window.history.replaceState(null, "", url);
  });
  useEffect(() => {
    if (!requested) return;
    const frame = requestAnimationFrame(onOpen);
    return () => cancelAnimationFrame(frame);
  }, [requested]);
}

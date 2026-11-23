"use client";

import { useTranslations } from "next-intl";
import { MAIN_ID } from "@/lib/landmarks";

export function SkipLink() {
  const t = useTranslations("shell");
  return (
    <a
      href={`#${MAIN_ID}`}
      // Safari doesn't move focus on same-page fragment navigation.
      onClick={() => document.getElementById(MAIN_ID)?.focus()}
      // Parked above the viewport rather than sr-only: `not-sr-only` drops the padding in WebKit.
      className="bg-background text-foreground ring-ring border-border fixed top-3 left-3 z-50 translate-y-[calc(-100%_-_2rem)] rounded-md border px-4 py-2.5 text-sm font-medium shadow-md focus:translate-y-0 focus:ring-2"
    >
      {t("skipToContent")}
    </a>
  );
}

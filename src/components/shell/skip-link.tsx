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
      className="bg-background text-foreground ring-ring sr-only rounded-md px-4 py-2 text-sm font-medium shadow-md focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:ring-2"
    >
      {t("skipToContent")}
    </a>
  );
}

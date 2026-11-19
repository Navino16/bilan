"use client";

import Link from "next/link";
import { useLocale } from "next-intl";
import type { ReactNode } from "react";

// `<link>` chunk renderer for messages pointing to Settings › AI assistants.
export function useAiSettingsLink(): (chunks: ReactNode) => ReactNode {
  const locale = useLocale();
  return function AiSettingsLink(chunks) {
    return (
      <Link href={`/${locale}/settings/ai`} className="font-medium underline underline-offset-2">
        {chunks}
      </Link>
    );
  };
}

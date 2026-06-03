"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { cn } from "@/lib/utils";

export function ImportTabs() {
  const t = useTranslations("import");
  const locale = useLocale();
  const pathname = usePathname();
  const tabs = [
    { key: "csvTab", href: `/${locale}/import/csv` },
    { key: "pdfTab", href: `/${locale}/import/pdf` },
  ];
  return (
    <div className="border-border flex gap-1 border-b">
      {tabs.map((tab) => {
        const active = pathname === tab.href;
        return (
          <Link
            key={tab.key}
            href={tab.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "-mb-px border-b-2 px-4 py-2 text-sm transition-colors",
              active
                ? "border-primary text-foreground font-medium"
                : "text-muted-foreground hover:text-foreground border-transparent",
            )}
          >
            {t(tab.key)}
          </Link>
        );
      })}
    </div>
  );
}

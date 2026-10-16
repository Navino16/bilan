"use client";

import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { BOTTOM_NAV } from "./nav-items";
import { usePendingNavigation } from "./navigation-pending";

export function BottomNav({ className }: { className?: string }) {
  const t = useTranslations("shell.tabs");
  const tFull = useTranslations("shell.nav");
  const tShell = useTranslations("shell");
  const locale = useLocale();
  const { pathname, targetPathname, onNavigateTo } = usePendingNavigation();

  return (
    <nav
      aria-label={tShell("tabsNav")}
      className={cn(
        "bg-sidebar border-border fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t pb-[env(safe-area-inset-bottom)]",
        className,
      )}
    >
      {BOTTOM_NAV.map((item) => {
        const href = `/${locale}${item.href}`;
        const isAt = (path: string) =>
          [item.href, ...(item.alsoActiveOn ?? [])].some((base) => {
            const prefix = `/${locale}${base}`;
            return path === prefix || path.startsWith(`${prefix}/`);
          });
        const current = isAt(pathname);
        const shown = isAt(targetPathname);
        const Icon = item.icon;
        return (
          <Link
            key={item.key}
            href={href}
            aria-current={current ? "page" : undefined}
            data-pending={shown && !current ? "" : undefined}
            onNavigate={onNavigateTo(href)}
            aria-label={tFull(item.key)}
            className={cn(
              "flex min-w-0 flex-col items-center gap-1 px-0.5 py-2.5 text-[10px] transition-colors",
              shown ? "text-primary font-medium" : "text-muted-foreground",
            )}
          >
            <Icon className="h-5 w-5 shrink-0" />
            <span className="w-full truncate text-center leading-tight">{t(item.key)}</span>
          </Link>
        );
      })}
    </nav>
  );
}

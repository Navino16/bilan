"use client";

import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import type { NavItem } from "./nav-items";
import { usePendingNavigation } from "./navigation-pending";

export function NavLink({ item, onSelect }: { item: NavItem; onSelect?: () => void }) {
  const t = useTranslations("shell.nav");
  const locale = useLocale();
  const { pathname, targetPathname, onNavigateTo } = usePendingNavigation();
  const href = `/${locale}${item.href}`;
  const isAt = (path: string) => path === href || path.startsWith(`${href}/`);
  const current = isAt(pathname);
  // Shown as active as soon as it is clicked; aria-current waits for the real page.
  const shown = isAt(targetPathname);
  const Icon = item.icon;

  return (
    <Link
      href={href}
      onClick={onSelect}
      onNavigate={onNavigateTo(href)}
      aria-current={current ? "page" : undefined}
      data-pending={shown && !current ? "" : undefined}
      className={cn(
        "flex h-9 items-center gap-3 rounded-md px-3 text-sm transition-colors",
        shown
          ? "bg-card text-foreground border-border border font-medium shadow-sm"
          : "text-muted-foreground hover:bg-accent/60 hover:text-foreground border border-transparent",
      )}
    >
      <Icon className={cn("h-4 w-4", shown && "text-primary")} />
      {t(item.key)}
    </Link>
  );
}

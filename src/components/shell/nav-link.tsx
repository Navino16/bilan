"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import type { NavItem } from "./nav-items";

export function NavLink({ item, onNavigate }: { item: NavItem; onNavigate?: () => void }) {
  const t = useTranslations("shell.nav");
  const locale = useLocale();
  const pathname = usePathname();
  const href = `/${locale}${item.href}`;
  const active = pathname === href || pathname.startsWith(`${href}/`);
  const Icon = item.icon;

  return (
    <Link
      href={href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex h-9 items-center gap-3 rounded-md px-3 text-sm transition-colors",
        active
          ? "bg-card text-foreground border-border border font-medium shadow-sm"
          : "text-muted-foreground hover:bg-accent/60 hover:text-foreground border border-transparent",
      )}
    >
      <Icon className={cn("h-4 w-4", active && "text-primary")} />
      {t(item.key)}
    </Link>
  );
}

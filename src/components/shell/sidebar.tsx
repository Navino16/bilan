"use client";

import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { ThemeToggle } from "@/components/theme-toggle";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import { ACCOUNT_NAV, WORKSPACE_NAV } from "./nav-items";
import { NavLink } from "./nav-link";

type SidebarUser = { name?: string | null; email: string };

export function Sidebar({
  user,
  canAdmin,
  className,
}: {
  user: SidebarUser;
  canAdmin: boolean;
  className?: string;
}) {
  const t = useTranslations("shell");
  const locale = useLocale();
  const accountItems = ACCOUNT_NAV.filter((item) => !item.permission || canAdmin);
  const display = user.name?.trim() || user.email;
  const initials = display.slice(0, 2).toUpperCase();

  return (
    <aside
      className={cn("bg-sidebar border-border flex w-60 shrink-0 flex-col border-r", className)}
    >
      <div className="px-5 py-6">
        <Link href={`/${locale}/dashboard`} className="font-display text-2xl tracking-tight">
          Bilan
        </Link>
        <p className="text-muted-foreground mt-0.5 text-[10px] tracking-[0.12em] uppercase">
          {t("tagline")}
        </p>
      </div>

      <nav aria-label="sidebar" className="flex-1 space-y-6 px-3">
        <div className="space-y-1">
          <p className="text-muted-foreground px-3 pb-1 text-[11px] font-medium tracking-wide uppercase">
            {t("groups.workspace")}
          </p>
          {WORKSPACE_NAV.map((item) => (
            <NavLink key={item.key} item={item} />
          ))}
        </div>
        <div className="space-y-1">
          <p className="text-muted-foreground px-3 pb-1 text-[11px] font-medium tracking-wide uppercase">
            {t("groups.account")}
          </p>
          {accountItems.map((item) => (
            <NavLink key={item.key} item={item} />
          ))}
        </div>
      </nav>

      <div className="border-border space-y-3 border-t px-4 py-4">
        <div className="flex items-center gap-3">
          <Avatar className="h-9 w-9">
            <AvatarFallback className="bg-accent text-accent-foreground text-xs font-medium">
              {initials}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{display}</p>
            <p className="text-muted-foreground truncate text-xs">{user.email}</p>
          </div>
        </div>
        <ThemeToggle label={t("themeToggle")} />
      </div>
    </aside>
  );
}

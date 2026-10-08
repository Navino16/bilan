"use client";

import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { ThemeToggle } from "@/components/theme-toggle";
import type { Theme } from "@/lib/theme";
import { cn } from "@/lib/utils";
import { ACCOUNT_NAV, WORKSPACE_NAV } from "./nav-items";
import { NavLink } from "./nav-link";
import { UserIdentity, type ShellUser } from "./user-identity";

export function Sidebar({
  user,
  canAdmin,
  appName,
  year,
  theme,
  className,
}: {
  user: ShellUser;
  canAdmin: boolean;
  appName: string;
  year: number;
  theme: Theme;
  className?: string;
}) {
  const t = useTranslations("shell");
  const locale = useLocale();
  const accountItems = ACCOUNT_NAV.filter((item) => !item.permission || canAdmin);

  return (
    <aside
      className={cn(
        "bg-sidebar border-border sticky top-0 flex h-svh w-60 shrink-0 flex-col self-start border-r",
        className,
      )}
    >
      <div className="px-5 py-6">
        <Link href={`/${locale}/dashboard`} className="font-display text-2xl tracking-tight">
          {appName}
        </Link>
        <p className="text-muted-foreground mt-0.5 text-[10px] tracking-[0.12em] uppercase">
          {t("tagline", { year: String(year) })}
        </p>
      </div>

      <nav aria-label="sidebar" className="min-h-0 flex-1 space-y-6 overflow-y-auto px-3">
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
        <UserIdentity user={user} />
        <ThemeToggle label={t("themeToggle")} theme={theme} />
      </div>
    </aside>
  );
}

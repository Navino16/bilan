"use client";

import { useState } from "react";
import { LogOut, Menu } from "lucide-react";
import { useTranslations } from "next-intl";
import { LanguageSwitcher } from "@/components/language-switcher";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import type { Theme } from "@/lib/theme";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { ACCOUNT_NAV, WORKSPACE_NAV } from "./nav-items";
import { NavLink } from "./nav-link";
import { useSignOut } from "./use-sign-out";
import { UserIdentity, type ShellUser } from "./user-identity";

export function MobileNav({
  user,
  canAdmin,
  appName,
  year,
  theme,
}: {
  user: ShellUser;
  canAdmin: boolean;
  appName: string;
  year: number;
  theme: Theme;
}) {
  const [open, setOpen] = useState(false);
  const t = useTranslations("shell");
  const signOut = useSignOut();
  const accountItems = ACCOUNT_NAV.filter((item) => !item.permission || canAdmin);
  const close = () => setOpen(false);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        aria-label={t("openMenu")}
        className="text-muted-foreground hover:text-foreground flex h-9 w-9 items-center justify-center rounded-md lg:hidden"
      >
        <Menu className="h-5 w-5" />
      </SheetTrigger>
      <SheetContent side="left" className="bg-sidebar flex w-72 flex-col gap-0 p-0">
        <SheetHeader className="shrink-0 py-6 pr-14 pl-5 text-left">
          <SheetTitle className="font-display line-clamp-2 text-2xl tracking-tight wrap-anywhere">
            {appName}
          </SheetTitle>
          <SheetDescription className="text-[10px] tracking-[0.12em] uppercase">
            {t("tagline", { year: String(year) })}
          </SheetDescription>
        </SheetHeader>

        <nav
          aria-label={t("mainNav")}
          className="min-h-0 flex-1 space-y-6 overflow-y-auto px-3 pb-4"
        >
          <div className="space-y-1">
            <p className="text-muted-foreground px-3 pb-1 text-[11px] font-medium tracking-wide uppercase">
              {t("groups.workspace")}
            </p>
            {WORKSPACE_NAV.map((item) => (
              <NavLink key={item.key} item={item} onSelect={close} />
            ))}
          </div>
          <div className="space-y-1">
            <p className="text-muted-foreground px-3 pb-1 text-[11px] font-medium tracking-wide uppercase">
              {t("groups.account")}
            </p>
            {accountItems.map((item) => (
              <NavLink key={item.key} item={item} onSelect={close} />
            ))}
          </div>
        </nav>

        <div className="border-border shrink-0 space-y-3 border-t px-5 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          <div className="flex items-center gap-2">
            <div className="min-w-0 flex-1">
              <UserIdentity user={user} />
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={signOut}
              aria-label={t("userMenu.logout")}
              title={t("userMenu.logout")}
            >
              <LogOut />
            </Button>
          </div>
          <div className="flex items-center justify-between gap-3">
            <ThemeToggle label={t("themeToggle")} theme={theme} />
            <LanguageSwitcher syncPreference />
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

"use client";

import { useState } from "react";
import { Menu } from "lucide-react";
import { useTranslations } from "next-intl";
import { LanguageSwitcher } from "@/components/language-switcher";
import { ThemeToggle } from "@/components/theme-toggle";
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

export function MobileNav({ canAdmin }: { canAdmin: boolean }) {
  const [open, setOpen] = useState(false);
  const t = useTranslations("shell");
  const accountItems = ACCOUNT_NAV.filter((item) => !item.permission || canAdmin);
  const close = () => setOpen(false);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        aria-label={t("openMenu")}
        className="text-muted-foreground hover:text-foreground flex h-9 w-9 items-center justify-center rounded-md md:hidden"
      >
        <Menu className="h-5 w-5" />
      </SheetTrigger>
      <SheetContent side="left" className="bg-sidebar flex w-72 flex-col gap-0 p-0">
        <SheetHeader className="px-5 py-6 text-left">
          <SheetTitle className="font-display text-2xl tracking-tight">Bilan</SheetTitle>
          <SheetDescription className="text-[10px] tracking-[0.12em] uppercase">
            {t("tagline")}
          </SheetDescription>
        </SheetHeader>

        <nav className="flex-1 space-y-6 px-3">
          <div className="space-y-1">
            <p className="text-muted-foreground px-3 pb-1 text-[11px] font-medium tracking-wide uppercase">
              {t("groups.workspace")}
            </p>
            {WORKSPACE_NAV.map((item) => (
              <NavLink key={item.key} item={item} onNavigate={close} />
            ))}
          </div>
          <div className="space-y-1">
            <p className="text-muted-foreground px-3 pb-1 text-[11px] font-medium tracking-wide uppercase">
              {t("groups.account")}
            </p>
            {accountItems.map((item) => (
              <NavLink key={item.key} item={item} onNavigate={close} />
            ))}
          </div>
        </nav>

        <div className="border-border flex items-center justify-between gap-3 border-t px-5 py-4">
          <ThemeToggle label={t("themeToggle")} />
          <LanguageSwitcher />
        </div>
      </SheetContent>
    </Sheet>
  );
}

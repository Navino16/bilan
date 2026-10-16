"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Monitor, Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { THEME_COLOR, THEMES, themeCookie, type Theme } from "@/lib/theme";

const OS_DARK = "(prefers-color-scheme: dark)";
const ICONS = { light: Sun, dark: Moon, system: Monitor } as const;

function setThemeColor(color: string) {
  // Updated in place rather than removed: the tags are React-managed.
  for (const meta of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) {
    meta.removeAttribute("media");
    meta.content = color;
  }
}

// Another mounted toggle (sidebar vs. mobile drawer) may have changed the theme.
function documentTheme(): Theme {
  const root = document.documentElement.classList;
  return root.contains("dark") ? "dark" : root.contains("light") ? "light" : "system";
}

export function ThemeToggle({ theme }: { theme: Theme }) {
  const t = useTranslations("shell.theme");
  const [choice, setChoice] = useState<Theme>(theme);
  const Icon = ICONS[choice];

  function apply(next: Theme) {
    setChoice(next);
    const root = document.documentElement.classList;
    root.toggle("dark", next === "dark");
    root.toggle("light", next === "light");
    const dark = next === "system" ? window.matchMedia(OS_DARK).matches : next === "dark";
    setThemeColor(dark ? THEME_COLOR.dark : THEME_COLOR.light);
    document.cookie = themeCookie(next);
  }

  return (
    <DropdownMenu onOpenChange={(open) => open && setChoice(documentTheme())}>
      <DropdownMenuTrigger
        render={<Button variant="ghost" size="sm" className="text-muted-foreground" />}
      >
        <Icon />
        {t(`current.${choice}`)}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-44">
        <DropdownMenuRadioGroup value={choice} onValueChange={(v) => apply(v as Theme)}>
          {THEMES.map((option) => {
            const OptionIcon = ICONS[option];
            return (
              <DropdownMenuRadioItem key={option} value={option}>
                <OptionIcon />
                {t(option)}
              </DropdownMenuRadioItem>
            );
          })}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

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
import { SYSTEM_THEME_COLORS, THEME_COLOR, THEMES, themeCookie, type Theme } from "@/lib/theme";

const ICONS = { light: Sun, dark: Moon, system: Monitor } as const;

// Updated in place rather than removed: the tags are React-managed. A pinned theme renders
// a single tag, so going back to "system" adds the second one the layout would render.
function setThemeColor(theme: Theme) {
  const metas = [...document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')];
  if (theme !== "system") {
    for (const meta of metas) {
      meta.removeAttribute("media");
      meta.content = THEME_COLOR[theme];
    }
    return;
  }
  SYSTEM_THEME_COLORS.forEach(({ media, color }, i) => {
    let meta = metas[i];
    if (!meta) {
      meta = document.createElement("meta");
      meta.name = "theme-color";
      const last = metas.at(-1);
      if (last) last.after(meta);
      else document.head.append(meta);
      metas.push(meta);
    }
    meta.media = media;
    meta.content = color;
  });
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
    setThemeColor(next);
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

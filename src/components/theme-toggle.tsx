"use client";

import { useEffect, useState } from "react";
import { Switch } from "@/components/ui/switch";
import { THEME_COLOR, THEME_COOKIE, type Theme } from "@/lib/theme";

const OS_DARK = "(prefers-color-scheme: dark)";

function effectiveDark(): boolean {
  const root = document.documentElement.classList;
  if (root.contains("dark")) return true;
  if (root.contains("light")) return false;
  return window.matchMedia(OS_DARK).matches;
}

function setThemeColor(color: string) {
  // Updated in place rather than removed: the tags are React-managed.
  for (const meta of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) {
    meta.removeAttribute("media");
    meta.content = color;
  }
}

export function ThemeToggle({ label, theme }: { label: string; theme: Theme }) {
  const [isDark, setIsDark] = useState(theme === "dark");

  useEffect(() => {
    if (theme !== "system") return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsDark(effectiveDark());
    const media = window.matchMedia(OS_DARK);
    const sync = () => setIsDark(effectiveDark());
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, [theme]);

  function toggle(next: boolean) {
    setIsDark(next);
    const root = document.documentElement.classList;
    root.toggle("dark", next);
    root.toggle("light", !next);
    setThemeColor(next ? THEME_COLOR.dark : THEME_COLOR.light);
    document.cookie = `${THEME_COOKIE}=${next ? "dark" : "light"}; path=/; max-age=31536000; samesite=lax`;
  }

  return (
    <label className="flex items-center gap-3 text-sm">
      <Switch checked={isDark} onCheckedChange={toggle} aria-label={label} />
      <span>{label}</span>
    </label>
  );
}

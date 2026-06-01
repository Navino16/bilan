"use client";

import { useEffect, useState } from "react";
import { Switch } from "@/components/ui/switch";
import { THEME_COOKIE } from "@/lib/theme";

export function ThemeToggle({ label }: { label: string }) {
  // The server set the `.dark` class on <html> from the theme cookie; read it
  // back from the DOM so the Switch reflects the current theme on mount.
  const [isDark, setIsDark] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsDark(document.documentElement.classList.contains("dark"));
  }, []);

  function toggle(next: boolean) {
    setIsDark(next);
    document.documentElement.classList.toggle("dark", next);
    // Persist for one year; the server reads this cookie on the next request to
    // SSR the right theme with no flash.
    document.cookie = `${THEME_COOKIE}=${next ? "dark" : "light"}; path=/; max-age=31536000; samesite=lax`;
  }

  return (
    <label className="flex items-center gap-3 text-sm">
      <Switch checked={isDark} onCheckedChange={toggle} aria-label={label} />
      <span>{label}</span>
    </label>
  );
}

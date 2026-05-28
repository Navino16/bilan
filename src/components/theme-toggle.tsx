"use client";

import { useEffect, useState } from "react";
import { Switch } from "@/components/ui/switch";
import { THEME_STORAGE_KEY } from "@/lib/theme";

export function ThemeToggle({ label }: { label: string }) {
  // The blocking script in `<head>` has already applied the `.dark` class
  // before hydration; read it from the DOM so the Switch is in sync on mount.
  const [isDark, setIsDark] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsDark(document.documentElement.classList.contains("dark"));
  }, []);

  function toggle(next: boolean) {
    setIsDark(next);
    document.documentElement.classList.toggle("dark", next);
    window.localStorage.setItem(THEME_STORAGE_KEY, next ? "dark" : "light");
  }

  return (
    <label className="flex items-center gap-3 text-sm">
      <Switch checked={isDark} onCheckedChange={toggle} aria-label={label} />
      <span>{label}</span>
    </label>
  );
}

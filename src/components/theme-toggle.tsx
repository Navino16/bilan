"use client";

import { useEffect, useState } from "react";
import { Switch } from "@/components/ui/switch";

const STORAGE_KEY = "bilan-theme";

export function ThemeToggle({ label }: { label: string }) {
  const [isDark, setIsDark] = useState(false);

  useEffect(() => {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    const initialDark =
      stored === "dark" ||
      (stored === null && window.matchMedia("(prefers-color-scheme: dark)").matches);
    // One-shot sync of persisted preference into React state on mount; the
    // Switch is intentionally rendered "off" during SSR and corrected here.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsDark(initialDark);
    document.documentElement.classList.toggle("dark", initialDark);
  }, []);

  function toggle(next: boolean) {
    setIsDark(next);
    document.documentElement.classList.toggle("dark", next);
    window.localStorage.setItem(STORAGE_KEY, next ? "dark" : "light");
  }

  return (
    <label className="flex items-center gap-3 text-sm">
      <Switch checked={isDark} onCheckedChange={toggle} aria-label={label} />
      <span>{label}</span>
    </label>
  );
}

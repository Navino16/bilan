"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

// Editorial label used across the design (uppercase, wide tracking, meta tone).
export const overline =
  "text-[0.7rem] font-medium tracking-[0.14em] uppercase text-muted-foreground";

export function Pill({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        "border-border text-muted-foreground inline-flex h-5 items-center rounded-full border px-2 text-[0.65rem] font-medium whitespace-nowrap",
        className,
      )}
    >
      {children}
    </span>
  );
}

// Colored, rounded category badge with the seeded emoji icon.
export function CategoryAvatar({
  color,
  icon,
  size = 26,
}: {
  color?: string | null;
  icon?: string | null;
  size?: number;
}) {
  return (
    <span
      aria-hidden
      className="inline-flex shrink-0 items-center justify-center rounded-md text-white"
      style={{
        width: size,
        height: size,
        background: color ?? "var(--ink-3)",
        fontSize: Math.round(size * 0.46),
        opacity: 0.92,
      }}
    >
      {icon ?? ""}
    </span>
  );
}

export function CategoryChip({ name, color }: { name: string; color?: string | null }) {
  return (
    <span className="border-border inline-flex max-w-full items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs">
      <span
        aria-hidden
        className="size-2 shrink-0 rounded-full"
        style={{ background: color ?? "var(--ink-3)" }}
      />
      <span className="truncate">{name}</span>
    </span>
  );
}

export type SegItem<T extends string> = { id: T; label: string };

// Compact segmented control (the design's Tabs). Controlled.
export function SegmentedTabs<T extends string>({
  items,
  value,
  onChange,
  className,
}: {
  items: SegItem<T>[];
  value: T;
  onChange: (id: T) => void;
  className?: string;
}) {
  return (
    <div className={cn("bg-muted inline-flex items-center gap-0.5 rounded-lg p-0.5", className)}>
      {items.map((it) => (
        <button
          key={it.id}
          type="button"
          aria-pressed={value === it.id}
          onClick={() => onChange(it.id)}
          className={cn(
            "h-7 rounded-md px-3 text-[0.8rem] font-medium transition-colors",
            value === it.id
              ? "bg-card text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {it.label}
        </button>
      ))}
    </div>
  );
}

"use client";

import type { ReactNode } from "react";
import { Tag } from "lucide-react";
import { categoryGlyphColor, categoryTileColor } from "@/lib/category-appearance";
import { cn } from "@/lib/utils";
import { categoryPath, PATH_SEPARATOR } from "./category-tree";

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
  category,
  size = 26,
}: {
  category?: { color?: string | null; icon?: string | null } | null;
  size?: number;
}) {
  const color = categoryTileColor(category);
  return (
    <span
      aria-hidden
      className="text-category-glyph inline-flex shrink-0 items-center justify-center rounded-md"
      style={{
        width: size,
        height: size,
        background: color,
        color: categoryGlyphColor(color),
        fontSize: Math.round(size * 0.46),
        opacity: 0.92,
      }}
    >
      {category?.icon ?? <Tag style={{ width: size * 0.5, height: size * 0.5 }} />}
    </span>
  );
}

export type CategoryLabelData = {
  name: string;
  color?: string | null;
  icon?: string | null;
  parents?: readonly string[];
};

// "<emoji> Parent › Child" (#416): the muted parent path truncates before the child name.
// `dot` shows the colour dot when there is no emoji to show.
export function CategoryLabel({
  category,
  fallback,
  emoji = true,
  dot = false,
  className,
}: {
  category: CategoryLabelData | null | undefined;
  fallback?: string;
  emoji?: boolean;
  dot?: boolean;
  className?: string;
}) {
  if (!category) return <span className={cn("min-w-0 truncate", className)}>{fallback}</span>;
  const parents = category.parents ?? [];
  const showEmoji = emoji && !!category.icon;
  return (
    <span
      data-slot="category-label"
      title={categoryPath(category)}
      className={cn("inline-flex min-w-0 items-center gap-1 overflow-hidden", className)}
    >
      {showEmoji ? (
        <>
          <span aria-hidden className="shrink-0">
            {category.icon}
          </span>{" "}
        </>
      ) : (
        dot && (
          <span
            aria-hidden
            className="mr-0.5 size-2 shrink-0 rounded-full"
            style={{ background: category.color ?? "var(--cat-other)" }}
          />
        )
      )}
      {/* The parent path shrinks first, down to its ellipsis; only then does the child truncate. */}
      <span className="flex min-w-0">
        {parents.length > 0 && (
          <>
            <span className="text-muted-foreground min-w-[1.25em] shrink-[100] truncate">
              {parents.join(PATH_SEPARATOR)}
            </span>
            {/* Outside the truncated span, so the ellipsis never swallows the separator. */}
            <span className="text-muted-foreground shrink-0">{`\u00a0${PATH_SEPARATOR.trim()}\u00a0`}</span>
          </>
        )}
        <span className="min-w-0 truncate">{category.name}</span>
      </span>
    </span>
  );
}

// Inside a row that already has a CategoryAvatar, `emoji={false}` keeps the dot.
export function CategoryChip({
  category,
  emoji = true,
}: {
  category: CategoryLabelData;
  emoji?: boolean;
}) {
  return (
    <span className="border-border inline-flex max-w-full items-center rounded-full border px-2 py-0.5 text-xs">
      <CategoryLabel category={category} emoji={emoji} dot />
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
  disabled,
  fullWidth = false,
  "aria-label": ariaLabel,
}: {
  items: SegItem<T>[];
  value: T;
  onChange: (id: T) => void;
  className?: string;
  disabled?: boolean;
  /** One row spanning the container; segments share it from their content width. */
  fullWidth?: boolean;
  "aria-label"?: string;
}) {
  return (
    <div
      role={ariaLabel ? "group" : undefined}
      aria-label={ariaLabel}
      className={cn(
        "bg-muted inline-flex items-center gap-0.5 rounded-lg p-0.5",
        fullWidth && "flex w-full flex-nowrap",
        className,
      )}
    >
      {items.map((it) => (
        <button
          key={it.id}
          type="button"
          aria-pressed={value === it.id}
          title={fullWidth ? it.label : undefined}
          disabled={disabled}
          onClick={() => onChange(it.id)}
          className={cn(
            "h-7 shrink-0 rounded-md px-3 text-[0.8rem] font-medium whitespace-nowrap transition-colors disabled:cursor-not-allowed disabled:opacity-60",
            fullWidth && "min-w-0 shrink grow truncate px-1.5",
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

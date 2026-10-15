"use client";

import { useId, useState } from "react";
import { useTranslations } from "next-intl";
import { ChevronDown, Check } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { FlatCategory } from "./category-tree";

// Styled category chooser matching the filter dropdown (colored dots + indented
// hierarchy). Works as a form field via a hidden input named `name`, and calls
// `onChange` when the selection changes.
export function CategoryCombobox({
  id,
  "aria-label": ariaLabel,
  name,
  categories,
  defaultValue,
  unlisted,
  onChange,
}: {
  id?: string;
  "aria-label"?: string;
  // When set, mirrors the value into a hidden input (form-field use). Omit for a
  // purely controlled chooser (e.g. the import preview rows).
  name?: string;
  categories: FlatCategory[];
  defaultValue?: string | null;
  // Shown for a starting value the user can't pick (another user's category).
  unlisted?: { name: string; color: string | null };
  onChange?: (id: string) => void;
}) {
  const t = useTranslations("transactions");
  const valueId = useId();
  const [value, setValue] = useState(defaultValue ?? "");
  const current =
    categories.find((c) => c.id === value) ??
    (value && value === defaultValue ? unlisted : undefined);

  function select(id: string) {
    setValue(id);
    onChange?.(id);
  }

  return (
    <>
      {name && <input type="hidden" name={name} value={value} />}
      <DropdownMenu>
        <DropdownMenuTrigger
          id={id}
          aria-label={ariaLabel}
          aria-describedby={id || ariaLabel ? valueId : undefined}
          render={
            <button
              type="button"
              data-slot="category-combobox"
              className="border-input hover:bg-muted/40 focus-visible:border-ring focus-visible:ring-ring/50 dark:bg-input/30 flex h-8 w-full min-w-0 items-center gap-2 rounded-lg border bg-transparent px-2.5 text-base outline-none focus-visible:ring-3 md:text-sm"
            />
          }
        >
          {current && (
            <span
              aria-hidden
              className="size-2.5 shrink-0 rounded-full"
              style={{ background: current.color ?? "var(--cat-other)" }}
            />
          )}
          <span id={valueId} className="flex-1 truncate text-left">
            {current?.name ?? t("noCategory")}
          </span>
          <ChevronDown className="text-muted-foreground size-4 shrink-0" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="max-h-80 w-64 overflow-auto">
          <DropdownMenuItem onClick={() => select("")}>
            <span className="flex-1">{t("noCategory")}</span>
            {!value && <Check className="size-3.5" />}
          </DropdownMenuItem>
          {categories.map((c) => (
            <DropdownMenuItem key={c.id} onClick={() => select(c.id)}>
              <span
                aria-hidden
                className="size-2 shrink-0 rounded-full"
                style={{ marginLeft: c.depth * 10, background: c.color ?? "var(--cat-other)" }}
              />
              <span className="flex-1 truncate">{c.name}</span>
              {value === c.id && <Check className="size-3.5" />}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}

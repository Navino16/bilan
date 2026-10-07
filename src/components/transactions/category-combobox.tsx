"use client";

import { useState } from "react";
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
  name,
  categories,
  defaultValue,
  unlisted,
  onChange,
}: {
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
          render={
            <button
              type="button"
              data-slot="category-combobox"
              className="border-input bg-background hover:bg-muted/40 flex h-9 w-full items-center gap-2 rounded-md border px-3 text-sm"
            />
          }
        >
          {current && (
            <span
              aria-hidden
              className="size-2.5 shrink-0 rounded-full"
              style={{ background: current.color ?? "var(--ink-3)" }}
            />
          )}
          <span className="flex-1 truncate text-left">{current?.name ?? t("noCategory")}</span>
          <ChevronDown className="size-4 shrink-0 opacity-60" />
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
                style={{ marginLeft: c.depth * 10, background: c.color ?? "var(--ink-3)" }}
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

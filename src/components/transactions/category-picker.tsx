"use client";

import { useTranslations } from "next-intl";
import { type FlatCategory } from "./category-tree";

export { flattenCategories, type FlatCategory } from "./category-tree";

export function CategoryPicker({
  name,
  categories,
  defaultValue,
  onChange,
}: {
  name: string;
  categories: FlatCategory[];
  defaultValue?: string | null;
  onChange?: (id: string) => void;
}) {
  const t = useTranslations("transactions");
  return (
    <select
      name={name}
      defaultValue={defaultValue ?? ""}
      onChange={(e) => onChange?.(e.target.value)}
      className="border-input bg-background h-9 w-full rounded-md border px-3 text-sm"
    >
      <option value="">{t("noCategory")}</option>
      {categories.map((c) => (
        <option key={c.id} value={c.id}>
          {`${"  ".repeat(c.depth)}${c.name}`}
        </option>
      ))}
    </select>
  );
}

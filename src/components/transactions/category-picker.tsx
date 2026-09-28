"use client";

import { useTranslations } from "next-intl";
import { type FlatCategory } from "./category-tree";
import { NativeSelect } from "@/components/ui/native-select";

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
    <NativeSelect
      name={name}
      defaultValue={defaultValue ?? ""}
      onChange={(e) => onChange?.(e.target.value)}
    >
      <option value="">{t("noCategory")}</option>
      {categories.map((c) => (
        <option key={c.id} value={c.id}>
          {`${"  ".repeat(c.depth)}${c.name}`}
        </option>
      ))}
    </NativeSelect>
  );
}

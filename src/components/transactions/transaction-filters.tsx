"use client";

import { useTranslations } from "next-intl";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { Tag, ChevronDown, Check } from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SegmentedTabs } from "./bits";
import { PeriodPicker } from "@/components/dashboard/period-picker";
import type { FlatCategory } from "./category-picker";

type Direction = "" | "in" | "out";

export function TransactionFilters({
  categories,
  from,
  to,
}: {
  categories: FlatCategory[];
  from?: string;
  to?: string;
}) {
  const t = useTranslations("transactions");
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  function setParam(key: string, value: string) {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    router.replace(`${pathname}?${next.toString()}`);
  }

  const dir = (params.get("dir") ?? "") as Direction;
  const activeCat = params.get("categoryId") ?? "";
  const activeCatName = categories.find((c) => c.id === activeCat)?.name ?? t("allCategories");

  return (
    <div className="flex flex-wrap items-center gap-2">
      <PeriodPicker from={from ?? ""} to={to ?? ""} />

      <Input
        type="search"
        placeholder={t("searchPlaceholder")}
        defaultValue={params.get("search") ?? ""}
        onChange={(e) => setParam("search", e.target.value)}
        aria-label={t("search")}
        className="h-8 w-full sm:w-56"
      />

      <SegmentedTabs<Direction>
        items={[
          { id: "", label: t("tab.all") },
          { id: "in", label: t("tab.in") },
          { id: "out", label: t("tab.out") },
        ]}
        value={dir}
        onChange={(v) => setParam("dir", v)}
      />

      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <button
              type="button"
              className="border-border bg-card text-muted-foreground hover:text-foreground inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-[0.8rem]"
            />
          }
        >
          <Tag className="size-3.5" />
          <span className="max-w-32 truncate">{activeCatName}</span>
          <ChevronDown className="size-3.5" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="max-h-80 w-56 overflow-auto">
          <DropdownMenuItem onClick={() => setParam("categoryId", "")}>
            <span className="flex-1">{t("allCategories")}</span>
            {!activeCat && <Check className="size-3.5" />}
          </DropdownMenuItem>
          {categories.map((c) => (
            <DropdownMenuItem key={c.id} onClick={() => setParam("categoryId", c.id)}>
              <span
                aria-hidden
                className="size-2 shrink-0 rounded-full"
                style={{ marginLeft: c.depth * 10, background: c.color ?? "var(--ink-3)" }}
              />
              <span className="flex-1 truncate">{c.name}</span>
              {activeCat === c.id && <Check className="size-3.5" />}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { Tag, ChevronDown, Check, ListFilter } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { NativeSelect } from "@/components/ui/native-select";
import { Sheet, SheetContent, SheetFooter, SheetTitle } from "@/components/ui/sheet";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SegmentedTabs, overline } from "./bits";
import { PeriodPicker } from "@/components/dashboard/period-picker";
import { useSelectionMode } from "./selection-mode";
import type { FlatCategory } from "./category-picker";
import { UNCATEGORIZED } from "@/lib/transaction-filters";

type Direction = "" | "in" | "out";

// Desktop: every filter inline. Mobile (issue #112 §5): search + a « Filtres » button
// opening a bottom sheet with the period, type, category and link mode.
export function TransactionFilters({
  categories,
  from,
  to,
  total,
}: {
  categories: FlatCategory[];
  from?: string;
  to?: string;
  total: number;
}) {
  const t = useTranslations("transactions");
  const tSheet = useTranslations("transactions.filterSheet");
  const tSel = useTranslations("transactions.selection");
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const { selecting, setSelecting } = useSelectionMode();
  const [sheetOpen, setSheetOpen] = useState(false);

  function replaceParams(update: (next: URLSearchParams) => void) {
    const next = new URLSearchParams(params.toString());
    next.delete("limit");
    update(next);
    router.replace(`${pathname}?${next.toString()}`);
  }
  function setParam(key: string, value: string) {
    replaceParams((next) => (value ? next.set(key, value) : next.delete(key)));
  }
  function resetFilters() {
    replaceParams((next) => ["dir", "categoryId", "from", "to"].forEach((k) => next.delete(k)));
  }

  const dir = (params.get("dir") ?? "") as Direction;
  const activeCat = params.get("categoryId") ?? "";
  const activeCatName =
    activeCat === UNCATEGORIZED
      ? t("noCategory")
      : (categories.find((c) => c.id === activeCat)?.name ?? t("allCategories"));
  const activeCount = [from || to, dir, activeCat].filter(Boolean).length;

  const directionTabs = (
    <SegmentedTabs<Direction>
      items={[
        { id: "", label: t("tab.all") },
        { id: "in", label: t("tab.in") },
        { id: "out", label: t("tab.out") },
      ]}
      value={dir}
      onChange={(v) => setParam("dir", v)}
    />
  );

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="hidden md:contents">
        <PeriodPicker from={from ?? ""} to={to ?? ""} />
      </div>

      <Input
        type="search"
        placeholder={t("searchPlaceholder")}
        defaultValue={params.get("search") ?? ""}
        onChange={(e) => setParam("search", e.target.value)}
        aria-label={t("search")}
        className="h-8 min-w-0 flex-1 md:w-56 md:flex-none"
      />

      <div className="hidden md:contents">
        {directionTabs}
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
            <DropdownMenuItem onClick={() => setParam("categoryId", UNCATEGORIZED)}>
              <span className="flex-1">{t("noCategory")}</span>
              {activeCat === UNCATEGORIZED && <Check className="size-3.5" />}
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

      <Button
        type="button"
        variant="outline"
        className="md:hidden"
        onClick={() => setSheetOpen(true)}
        data-slot="filters-open"
      >
        <ListFilter />
        {t("filters")}
        {activeCount > 0 && (
          <span className="bg-primary text-primary-foreground rounded-full px-1.5 text-[0.7rem] leading-[18px]">
            {activeCount}
          </span>
        )}
      </Button>

      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent
          side="bottom"
          showCloseButton={false}
          className="max-h-[85dvh] gap-5 overflow-y-auto rounded-t-2xl px-5 pt-3 pb-0"
        >
          <div aria-hidden className="bg-border mx-auto h-1 w-10 rounded-full" />
          <div className="flex items-baseline justify-between">
            <SheetTitle className="font-display text-2xl font-normal">{t("filters")}</SheetTitle>
            <button
              type="button"
              onClick={resetFilters}
              disabled={activeCount === 0}
              className="text-muted-foreground text-sm underline underline-offset-2 disabled:opacity-40"
            >
              {tSheet("reset")}
            </button>
          </div>

          <div className="space-y-2">
            <div className={overline}>{tSheet("period")}</div>
            <PeriodPicker from={from ?? ""} to={to ?? ""} wrap />
          </div>

          <div className="space-y-2">
            <div className={overline}>{t("type")}</div>
            {directionTabs}
          </div>

          <div className="space-y-2">
            <Label htmlFor="filter-category" className={overline}>
              {t("category")}
            </Label>
            <NativeSelect
              id="filter-category"
              value={activeCat}
              onChange={(e) => setParam("categoryId", e.target.value)}
            >
              <option value="">{t("allCategories")}</option>
              <option value={UNCATEGORIZED}>{t("noCategory")}</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {`${"  ".repeat(c.depth)}${c.name}`}
                </option>
              ))}
            </NativeSelect>
          </div>

          <label className="flex items-center justify-between gap-4 border-t pt-4">
            <span>
              <span className="block text-sm">{tSel("mode")}</span>
              <span className="text-muted-foreground block text-xs">{tSel("hint")}</span>
            </span>
            <Switch
              checked={selecting}
              onCheckedChange={(on) => {
                setSelecting(on);
                if (on) setSheetOpen(false);
              }}
            />
          </label>

          <SheetFooter className="bg-popover sticky bottom-0 -mx-5 mt-0 px-5 pt-2 pb-5">
            <Button size="lg" onClick={() => setSheetOpen(false)}>
              {tSheet("show", { count: total })}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </div>
  );
}

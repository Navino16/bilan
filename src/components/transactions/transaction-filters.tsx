"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { Tag, ChevronDown, Check, ListFilter, Landmark, Shapes, X } from "lucide-react";
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
import {
  DEFAULT_SORT,
  FILTER_PARAMS,
  TRANSACTION_SORTS,
  UNCATEGORIZED,
} from "@/lib/transaction-filters";
import { TRANSACTION_TYPES } from "@/lib/validation/transaction";
import { readAmount } from "@/lib/amount";
import { hasUnsearchableWord, MIN_SEARCH_WORD } from "@/lib/text";

type Direction = "" | "in" | "out";

const SEARCH_DEBOUNCE_MS = 350;

const trigger =
  "border-border bg-card text-muted-foreground hover:text-foreground inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-[0.8rem]";

function FilterMenu({
  icon,
  activeLabel,
  allLabel,
  value,
  options,
  onSelect,
}: {
  icon: React.ReactNode;
  activeLabel: string;
  allLabel: string;
  value: string;
  options: { value: string; label: string }[];
  onSelect: (value: string) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<button type="button" className={trigger} />}>
        {icon}
        <span className="max-w-32 truncate">{activeLabel}</span>
        <ChevronDown className="size-3.5" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-80 w-56 overflow-auto">
        {[{ value: "", label: allLabel }, ...options].map((o) => (
          <DropdownMenuItem key={o.value} onClick={() => onSelect(o.value)}>
            <span className="flex-1 truncate">{o.label}</span>
            {value === o.value && <Check className="size-3.5" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// Committed on blur/Enter as an absolute amount; an unparseable entry stays local, flagged.
function AmountBoundInput({
  value,
  label,
  className,
  onCommit,
}: {
  value: string;
  label: string;
  className?: string;
  onCommit: (value: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  const [seen, setSeen] = useState(value);
  if (value !== seen) {
    setSeen(value);
    setDraft(value);
  }
  const parsed = draft.trim() ? readAmount(draft) : null;
  const invalid = parsed !== null && !parsed.ok;

  function commit() {
    if (invalid) return;
    const next = parsed?.ok ? String(Math.abs(parsed.value)) : "";
    if (next !== value) onCommit(next);
  }

  return (
    <Input
      inputMode="decimal"
      aria-label={label}
      placeholder={label}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") commit();
      }}
      aria-invalid={invalid || undefined}
      className={className}
    />
  );
}

// Desktop: every filter inline. Mobile (issue #112 §5): search + a « Filtres » button
// opening a bottom sheet with the other filters, the sort and link mode.
export function TransactionFilters({
  categories,
  accounts,
  from,
  to,
  total,
}: {
  categories: FlatCategory[];
  accounts: { id: string; name: string }[];
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

  // The box is controlled and debounced. A URL change is copied into it unless
  // one of our own pushes is in flight (typing must not be overwritten by it).
  const urlSearch = params.get("search") ?? "";
  const [search, setSearch] = useState(urlSearch);
  const [seenUrlSearch, setSeenUrlSearch] = useState(urlSearch);
  const [pushedSearch, setPushedSearch] = useState<string | null>(null);
  const searchTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  if (urlSearch !== seenUrlSearch) {
    setSeenUrlSearch(urlSearch);
    if (pushedSearch === null) setSearch(urlSearch);
    else if (urlSearch === pushedSearch) setPushedSearch(null);
  }
  useEffect(() => () => clearTimeout(searchTimer.current), []);

  function onSearchChange(value: string) {
    setSearch(value);
    clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => {
      const q = value.trim();
      if (q === (new URLSearchParams(window.location.search).get("search") ?? "")) return;
      setPushedSearch(q);
      setParam("search", q);
    }, SEARCH_DEBOUNCE_MS);
  }

  // Built from the live URL: the debounced search runs after later renders.
  function replaceParams(update: (next: URLSearchParams) => void) {
    const next = new URLSearchParams(window.location.search);
    next.delete("limit");
    update(next);
    router.replace(`${pathname}?${next.toString()}`);
  }
  function setParam(key: string, value: string) {
    replaceParams((next) => (value ? next.set(key, value) : next.delete(key)));
  }
  function resetFilters() {
    replaceParams((next) => FILTER_PARAMS.forEach((k) => next.delete(k)));
  }

  const dir = (params.get("dir") ?? "") as Direction;
  const activeCat = params.get("categoryId") ?? "";
  const activeCatName =
    activeCat === UNCATEGORIZED
      ? t("noCategory")
      : (categories.find((c) => c.id === activeCat)?.name ?? t("allCategories"));
  const activeAccount = params.get("accountId") ?? "";
  const activeType = params.get("type") ?? "";
  const min = params.get("min") ?? "";
  const max = params.get("max") ?? "";
  const sort = params.get("sort") || DEFAULT_SORT;
  const activeCount = [from || to, dir, activeCat, activeAccount, activeType, min || max].filter(
    Boolean,
  ).length;
  const resettable = activeCount > 0 || sort !== DEFAULT_SORT;
  const shortWord = hasUnsearchableWord(search);

  const accountOptions = accounts.map((a) => ({ value: a.id, label: a.name }));
  const typeOptions = TRANSACTION_TYPES.map((ty) => ({ value: ty, label: t(`types.${ty}`) }));
  const optionLabel = (options: { value: string; label: string }[], v: string, all: string) =>
    options.find((o) => o.value === v)?.label ?? all;

  const sortSelect = (id?: string, className?: string) => (
    <NativeSelect
      id={id}
      aria-label={t("sortLabel")}
      value={sort}
      onChange={(e) => setParam("sort", e.target.value === DEFAULT_SORT ? "" : e.target.value)}
      className={className}
    >
      {TRANSACTION_SORTS.map((s) => (
        <option key={s} value={s}>
          {t(`sort.${s}`)}
        </option>
      ))}
    </NativeSelect>
  );

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
        value={search}
        onChange={(e) => onSearchChange(e.target.value)}
        aria-label={t("search")}
        aria-describedby={shortWord ? "search-hint" : undefined}
        className="h-8 min-w-0 flex-1 md:w-56 md:flex-none"
      />

      <div className="hidden md:contents">
        {directionTabs}
        <DropdownMenu>
          <DropdownMenuTrigger render={<button type="button" className={trigger} />}>
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
        <FilterMenu
          icon={<Landmark className="size-3.5" />}
          activeLabel={optionLabel(accountOptions, activeAccount, t("allAccounts"))}
          allLabel={t("allAccounts")}
          value={activeAccount}
          options={accountOptions}
          onSelect={(v) => setParam("accountId", v)}
        />
        <FilterMenu
          icon={<Shapes className="size-3.5" />}
          activeLabel={optionLabel(typeOptions, activeType, t("allTypes"))}
          allLabel={t("allTypes")}
          value={activeType}
          options={typeOptions}
          onSelect={(v) => setParam("type", v)}
        />
        <AmountBoundInput
          value={min}
          label={t("amountMin")}
          className="h-8 w-28"
          onCommit={(v) => setParam("min", v)}
        />
        <AmountBoundInput
          value={max}
          label={t("amountMax")}
          className="h-8 w-28"
          onCommit={(v) => setParam("max", v)}
        />
        {sortSelect(undefined, "w-52")}
        {resettable && (
          <button
            type="button"
            onClick={resetFilters}
            data-slot="filters-reset"
            className="text-muted-foreground hover:text-foreground inline-flex h-8 items-center gap-1 px-1 text-[0.8rem] underline-offset-2 hover:underline"
          >
            <X className="size-3.5" />
            {tSheet("reset")}
          </button>
        )}
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

      {shortWord && (
        <p id="search-hint" className="text-muted-foreground w-full text-xs">
          {t("searchHint", { min: MIN_SEARCH_WORD })}
        </p>
      )}

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
              disabled={!resettable}
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
            <div className={overline}>{t("direction")}</div>
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

          <div className="space-y-2">
            <Label htmlFor="filter-account" className={overline}>
              {t("account")}
            </Label>
            <NativeSelect
              id="filter-account"
              value={activeAccount}
              onChange={(e) => setParam("accountId", e.target.value)}
            >
              <option value="">{t("allAccounts")}</option>
              {accountOptions.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </NativeSelect>
          </div>

          <div className="space-y-2">
            <Label htmlFor="filter-type" className={overline}>
              {t("type")}
            </Label>
            <NativeSelect
              id="filter-type"
              value={activeType}
              onChange={(e) => setParam("type", e.target.value)}
            >
              <option value="">{t("allTypes")}</option>
              {typeOptions.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </NativeSelect>
          </div>

          <div className="space-y-2">
            <div className={overline}>{t("amountRange")}</div>
            <div className="grid grid-cols-2 gap-3">
              <AmountBoundInput
                value={min}
                label={t("amountMin")}
                onCommit={(v) => setParam("min", v)}
              />
              <AmountBoundInput
                value={max}
                label={t("amountMax")}
                onCommit={(v) => setParam("max", v)}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="filter-sort" className={overline}>
              {t("sortLabel")}
            </Label>
            {sortSelect("filter-sort")}
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

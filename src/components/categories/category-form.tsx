"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { Check, Plus, Tag } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { useIsMobile } from "@/hooks/use-is-mobile";
import { useFrozenWhileOpen } from "@/hooks/use-frozen-while-open";
import { cn } from "@/lib/utils";
import { createCategoryAction, updateCategoryAction } from "@/server/transport/actions/categories";
import { CATEGORY_ICON_MAX, CATEGORY_NAME_MAX } from "@/lib/validation/category";
import { SHIFT_DAYS_MAX, SHIFT_DAYS_MIN } from "@/lib/assigned-month";
import { canManageInGroup, type GroupRole } from "@/lib/validation/group";
import {
  CATEGORY_PALETTE,
  CATEGORY_SYMBOLS,
  categoryGlyphColor,
  DEFAULT_CATEGORY_COLOR,
  isHexColor,
  paletteColor,
  paletteKeyOf,
  singleGrapheme,
  symbolKeyOf,
} from "@/lib/category-appearance";
import { useActionForm, type ActionForm } from "@/components/forms/use-action-form";
import { FieldError } from "@/components/forms/field-error";
import { NativeSelect } from "@/components/ui/native-select";
import { CategoryChip, overline } from "@/components/transactions/bits";
import { indentedName } from "@/components/transactions/category-tree";
import { pickableCategories, type CategoryOption } from "./category-options";

export type EditableCategory = {
  id: string;
  name: string;
  color: string | null;
  icon: string | null;
  parentId: string | null;
  groupId: string | null;
  shiftDays: number | null;
  savings: boolean;
};

export type ScopeGroup = { id: string; name: string; role: GroupRole };

// Up to this many scopes (personal included) render as segmented tabs, beyond as a select.
const MAX_SCOPE_TABS = 3;

// Same fallback as CategoryAvatar for a category without any colour.
const UNSET_COLOR = "var(--cat-other)";
// A native colour input needs a hex start value: the light theme's --cat-groceries.
const PICKER_START = "#5e8c5a";

const DEFAULT_SHIFT_DAYS = 5;

const legendClass = "mb-2 text-sm leading-none font-medium";
const hintClass = "text-muted-foreground text-xs";
const focusRing =
  "peer-focus-visible:ring-ring/50 peer-focus-visible:ring-3 peer-focus-visible:outline-none";

export function CategoryForm({
  mode,
  category,
  options,
  groups,
  trigger,
  open: controlledOpen,
  onOpenChange,
}: {
  mode: "create" | "edit";
  category?: EditableCategory;
  /** Every category the user can see; the form keeps the chosen scope's ones as parents. */
  options: CategoryOption[];
  groups: ScopeGroup[];
  trigger?: React.ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const t = useTranslations("categories");
  const router = useRouter();
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const open = controlledOpen ?? uncontrolledOpen;
  const setOpen = onOpenChange ?? setUncontrolledOpen;
  // Swapping Sheet↔Dialog mid-edit would remount the fields and lose the user's input.
  const isMobile = useFrozenWhileOpen(open, useIsMobile());
  const form = useActionForm(mode === "create" ? createCategoryAction : updateCategoryAction, {
    onSuccess: (_, { stale }) => {
      if (!stale) setOpen(false);
      router.refresh();
    },
  });

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next) form.reset();
  };

  const body = (
    <>
      <DialogHeader className="border-border shrink-0 border-b px-6 pt-5 pb-4 text-left max-md:px-5">
        <span className={overline}>{mode === "create" ? t("overlineNew") : t("edit")}</span>
        <DialogTitle className="font-display mt-1 text-2xl leading-tight">
          {mode === "create" ? t("createTitle") : t("editTitle")}
        </DialogTitle>
        <DialogDescription className="text-xs">
          {mode === "create" ? t("createHint") : t("editHint")}
        </DialogDescription>
      </DialogHeader>

      <form {...form.formProps} className="flex min-h-0 flex-1 flex-col">
        <div className="flex flex-1 flex-col gap-3.5 overflow-y-auto px-6 py-5 max-md:px-5">
          {mode === "edit" && <input type="hidden" name="id" value={category!.id} />}
          <CategoryFields
            mode={mode}
            category={category}
            options={options}
            groups={groups}
            form={form}
          />
          {form.error && (
            <p role="alert" className="text-destructive text-sm">
              {t(`error.${form.error}`)}
            </p>
          )}
        </div>

        <DialogFooter className="bg-muted/40 border-border shrink-0 border-t px-6 py-3 max-md:px-5">
          <Button type="button" variant="ghost" onClick={() => handleOpenChange(false)}>
            {t("cancel")}
          </Button>
          <Button type="submit" disabled={form.pending}>
            <Check />
            {form.pending ? t("saving") : mode === "create" ? t("createCta") : t("save")}
          </Button>
        </DialogFooter>
      </form>
    </>
  );

  return isMobile ? (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      {trigger && <SheetTrigger render={trigger as React.ReactElement} />}
      <SheetContent
        side="bottom"
        className="flex max-h-[92dvh] flex-col gap-0 overflow-hidden rounded-t-2xl p-0"
      >
        {body}
      </SheetContent>
    </Sheet>
  ) : (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      {trigger && <DialogTrigger render={trigger as React.ReactElement} />}
      <DialogContent className="flex max-h-[90dvh] flex-col gap-0 overflow-hidden p-0 sm:max-w-[480px]">
        {body}
      </DialogContent>
    </Dialog>
  );
}

// Mounted with the dialog content, so unsaved choices reset on each opening.
// Only a new root category gets a default colour. Otherwise a category without its own
// colour (inherited from its parent, or legacy) has no radio checked, so none is submitted.
function CategoryFields({
  mode,
  category,
  options,
  groups,
  form,
}: {
  mode: "create" | "edit";
  category?: EditableCategory;
  options: CategoryOption[];
  groups: ScopeGroup[];
  form: ActionForm;
}) {
  const t = useTranslations("categories");
  const ids = useId();
  const [name, setName] = useState(category?.name ?? "");
  const [scope, setScope] = useState(category?.groupId ?? "");
  const [parentId, setParentId] = useState(category?.parentId ?? "");
  const [color, setColor] = useState<string | null>(category?.color ?? null);
  const [icon, setIcon] = useState(category?.icon ?? "");
  const [shiftOn, setShiftOn] = useState(category?.shiftDays != null);
  const [savings, setSavings] = useState(category?.savings ?? false);
  const [customColor, setCustomColor] = useState(
    category?.color && !paletteKeyOf(category.color) ? category.color : null,
  );
  const [customIcon, setCustomIcon] = useState(
    category?.icon && !symbolKeyOf(category.icon) ? category.icon : null,
  );
  const [symbolDraftOpen, setSymbolDraftOpen] = useState(false);
  const [symbolDraft, setSymbolDraft] = useState("");
  const symbolDraftRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (symbolDraftOpen) symbolDraftRef.current?.focus();
  }, [symbolDraftOpen]);

  const locked = mode === "edit";
  const scopes = locked
    ? [
        {
          id: scope,
          label: scope
            ? (groups.find((g) => g.id === scope)?.name ?? t("scopeGroup"))
            : t("scopePersonal"),
        },
      ]
    : [
        { id: "", label: t("scopePersonal") },
        ...groups.filter((g) => canManageInGroup(g.role)).map((g) => ({ id: g.id, label: g.name })),
      ];
  const showScope = locked ? scope !== "" || groups.length > 0 : scopes.length > 1;

  const parents = pickableCategories(options, scope || null, category?.id);
  const parent = parents.find((p) => p.id === parentId);
  const checkedColor = color ?? (mode === "create" && !parent ? DEFAULT_CATEGORY_COLOR : null);
  const shownColor = checkedColor ?? parent?.color ?? UNSET_COLOR;
  const symbolDraftInvalid = symbolDraft.trim() !== "" && !singleGrapheme(symbolDraft);
  const symbolDraftId = `${ids}-symbol-draft`;
  const symbolErrorId = `${ids}-symbol-error`;

  function applySymbolDraft(value: string) {
    setSymbolDraft(value);
    const glyph = singleGrapheme(value);
    if (!glyph) return;
    if (!symbolKeyOf(glyph)) setCustomIcon(glyph);
    setIcon(glyph);
  }

  const scopeHintId = `${ids}-scope-hint`;
  const scopeHint = (
    <p id={scopeHintId} className={cn(hintClass, "mt-1.5")}>
      {scope ? t("scopeHintGroup") : t("scopeHintPersonal")}
      {locked && <> {t("scopeLocked")}</>}
    </p>
  );

  return (
    <>
      <div
        aria-hidden
        data-slot="category-preview"
        className="bg-muted border-border flex items-center gap-3 rounded-[10px] border border-dashed p-[18px]"
      >
        <span
          className="text-category-glyph flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-[10px] text-lg"
          style={{ background: shownColor, color: categoryGlyphColor(shownColor) }}
        >
          {icon ? <span className="truncate px-0.5">{icon}</span> : <Tag className="size-5" />}
        </span>
        <div className="min-w-0">
          <div className={cn(overline, "mb-0.5")}>{t("preview")}</div>
          <CategoryChip name={name.trim() || t("previewName")} color={shownColor} />
        </div>
      </div>

      {locked && scope ? <input type="hidden" name="groupId" value={scope} /> : null}

      <div className="space-y-2">
        <Label htmlFor="cat-name">{t("name")}</Label>
        <Input
          id="cat-name"
          name="name"
          defaultValue={category?.name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t("namePlaceholder")}
          required
          maxLength={CATEGORY_NAME_MAX}
          {...form.fieldProps("name")}
        />
        <FieldError form={form} name="name" />
      </div>

      <div className="space-y-2">
        <Label htmlFor="cat-parent">{t("parent")}</Label>
        <NativeSelect
          id="cat-parent"
          name="parentId"
          value={parentId}
          onChange={(e) => setParentId(e.target.value)}
        >
          <option value="">{t("noParent")}</option>
          {parents.map((p) => (
            <option key={p.id} value={p.id}>
              {indentedName(p.name, p.depth)}
            </option>
          ))}
        </NativeSelect>
      </div>

      {showScope &&
        (scopes.length > MAX_SCOPE_TABS ? (
          <div>
            <Label htmlFor="cat-scope" className="mb-2">
              {t("scope")}
            </Label>
            <NativeSelect
              id="cat-scope"
              name="groupId"
              value={scope}
              aria-describedby={scopeHintId}
              onChange={(e) => {
                setScope(e.target.value);
                setParentId("");
              }}
            >
              {scopes.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </NativeSelect>
            {scopeHint}
          </div>
        ) : (
          <fieldset aria-describedby={scopeHintId}>
            <legend className={legendClass}>{t("scope")}</legend>
            <div className="bg-muted border-border inline-flex max-w-full gap-0.5 rounded-[9px] border p-[3px]">
              {scopes.map((s) => (
                <label key={s.id} className="relative min-w-0">
                  <input
                    type="radio"
                    name={locked ? undefined : "groupId"}
                    value={s.id}
                    checked={scope === s.id}
                    disabled={locked}
                    onChange={() => {
                      setScope(s.id);
                      setParentId("");
                    }}
                    className="peer sr-only"
                  />
                  <span
                    className={cn(
                      "text-muted-foreground flex h-7 cursor-pointer items-center truncate rounded-md px-3 text-[0.8rem] font-medium transition-colors max-md:h-9",
                      "hover:text-foreground peer-checked:bg-card peer-checked:text-foreground peer-checked:shadow-sm",
                      "peer-disabled:hover:text-muted-foreground peer-disabled:cursor-default",
                      focusRing,
                    )}
                  >
                    {s.label}
                  </span>
                </label>
              ))}
            </div>
            {scopeHint}
          </fieldset>
        ))}

      <fieldset>
        <legend className={legendClass}>{t("color")}</legend>
        <div className="flex flex-wrap gap-2" data-slot="category-color-swatches">
          {[
            ...CATEGORY_PALETTE.map((key) => ({
              value: paletteColor(key),
              label: t(`colors.${key}`),
            })),
            ...(customColor
              ? [{ value: customColor, label: t("customColor", { color: customColor }) }]
              : []),
          ].map((c) => (
            <label key={c.value} className="relative">
              <input
                type="radio"
                name="color"
                value={c.value}
                aria-label={c.label}
                checked={checkedColor === c.value}
                onChange={() => setColor(c.value)}
                className="peer sr-only"
              />
              <span
                title={c.label}
                className={cn(
                  "block size-7 cursor-pointer rounded-lg border-2 border-transparent transition-transform hover:scale-105 max-md:size-10",
                  "peer-checked:border-foreground",
                  focusRing,
                )}
                style={{ background: c.value }}
              />
            </label>
          ))}
          <label className="relative" title={t("pickColor")}>
            <input
              type="color"
              aria-label={t("pickColor")}
              value={isHexColor(customColor) ? customColor : PICKER_START}
              onChange={(e) => {
                setCustomColor(e.target.value);
                setColor(e.target.value);
              }}
              className="peer sr-only"
              data-slot="category-color-picker"
            />
            <span
              aria-hidden
              className={cn(
                "border-border text-muted-foreground hover:text-foreground flex size-7 cursor-pointer items-center justify-center rounded-lg border-2 border-dashed max-md:size-10",
                focusRing,
              )}
            >
              <Plus className="size-3.5" />
            </span>
          </label>
        </div>
        {parent &&
          (color === null ? (
            <p className={cn(hintClass, "mt-1.5")}>{t("colorInherited")}</p>
          ) : (
            <button
              type="button"
              className="text-primary mt-1.5 text-xs underline-offset-2 hover:underline"
              onClick={() => setColor(null)}
            >
              {t("inheritColor")}
            </button>
          ))}
        <FieldError form={form} name="color" />
      </fieldset>

      <fieldset>
        <legend className={legendClass}>{t("symbol")}</legend>
        <div className="flex flex-wrap gap-1.5" data-slot="category-symbols">
          {[
            { value: "", label: t("noSymbol") },
            ...CATEGORY_SYMBOLS.map((s) => ({ value: s.glyph, label: t(`symbols.${s.key}`) })),
            ...(customIcon
              ? [{ value: customIcon, label: t("customSymbol", { glyph: customIcon }) }]
              : []),
          ].map((s) => (
            <label key={s.value || "none"} className="relative">
              <input
                type="radio"
                name="icon"
                value={s.value}
                aria-label={s.label}
                checked={icon === s.value}
                onChange={() => setIcon(s.value)}
                className="peer sr-only"
              />
              <span
                aria-hidden
                title={s.label}
                className={cn(
                  "bg-muted border-border flex size-8 cursor-pointer items-center justify-center overflow-hidden rounded-lg border text-sm transition-colors max-md:size-10",
                  "hover:border-foreground/40 peer-checked:bg-foreground peer-checked:text-background peer-checked:border-foreground",
                  focusRing,
                )}
              >
                {s.value ? (
                  <span className="truncate px-0.5">{s.value}</span>
                ) : (
                  <Tag className="size-3.5" />
                )}
              </span>
            </label>
          ))}
          <button
            type="button"
            aria-label={t("addSymbol")}
            title={t("addSymbol")}
            aria-expanded={symbolDraftOpen}
            aria-controls={symbolDraftOpen ? symbolDraftId : undefined}
            onClick={() => setSymbolDraftOpen((o) => !o)}
            className="border-border text-muted-foreground hover:text-foreground focus-visible:ring-ring/50 flex size-8 items-center justify-center rounded-lg border border-dashed focus-visible:ring-3 focus-visible:outline-none max-md:size-10"
          >
            <Plus className="size-3.5" />
          </button>
        </div>
        {symbolDraftOpen && (
          <div className="mt-2 flex items-center gap-2">
            <Input
              ref={symbolDraftRef}
              id={symbolDraftId}
              aria-label={t("symbolInput")}
              value={symbolDraft}
              onChange={(e) => applySymbolDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== "Enter") return;
                e.preventDefault();
                if (singleGrapheme(symbolDraft)) setSymbolDraftOpen(false);
              }}
              placeholder="🙂"
              maxLength={CATEGORY_ICON_MAX}
              autoComplete="off"
              aria-invalid={symbolDraftInvalid || undefined}
              aria-describedby={symbolDraftInvalid ? symbolErrorId : undefined}
              className="w-20 text-center"
            />
            {symbolDraftInvalid && (
              <p id={symbolErrorId} className="text-destructive text-xs">
                {t("symbolInvalid")}
              </p>
            )}
          </div>
        )}
        <FieldError form={form} name="icon" />
      </fieldset>

      <div className="space-y-2">
        <label className="flex items-center justify-between gap-4">
          <span>
            <span className="block text-sm font-medium">{t("shift")}</span>
            <span className={cn(hintClass, "block")}>{t("shiftHint")}</span>
          </span>
          <Switch checked={shiftOn} onCheckedChange={setShiftOn} />
        </label>
        {shiftOn ? (
          <div className="flex items-center gap-3">
            <Label htmlFor="cat-shift-days">{t("shiftDays")}</Label>
            <Input
              id="cat-shift-days"
              name="shiftDays"
              type="number"
              inputMode="numeric"
              min={SHIFT_DAYS_MIN}
              max={SHIFT_DAYS_MAX}
              defaultValue={category?.shiftDays ?? DEFAULT_SHIFT_DAYS}
              required
              className="w-20"
              {...form.fieldProps("shiftDays")}
            />
          </div>
        ) : (
          <input type="hidden" name="shiftDays" value="" />
        )}
        <FieldError form={form} name="shiftDays" />
      </div>

      <label className="flex items-center justify-between gap-4">
        <span>
          <span className="block text-sm font-medium">{t("savings")}</span>
          <span className={cn(hintClass, "block")}>{t("savingsHint")}</span>
        </span>
        <Switch checked={savings} onCheckedChange={setSavings} />
        <input type="hidden" name="savings" value={savings ? "on" : ""} />
      </label>
    </>
  );
}

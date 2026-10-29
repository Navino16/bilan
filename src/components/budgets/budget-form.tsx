"use client";

import { useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { Check, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { budgetPlannedTotal, periodEndFor } from "@/lib/budgets";
import { parseAmount, readAmount } from "@/lib/amount";
import { formatAmountInput, formatMoney } from "@/lib/format";
import {
  BUDGET_DESCRIPTION_MAX,
  BUDGET_LINE_LABEL_MAX,
  BUDGET_NAME_MAX,
  BUDGET_LINE_KINDS,
  BUDGET_PERIOD_TYPES,
  TRANSFER_DIRECTIONS,
  type BudgetLineKind,
  type BudgetPeriodType,
  type TransferDirection,
} from "@/lib/validation/budget";
import { lineFlow } from "@/lib/budget-match";
import { createBudgetAction, updateBudgetAction } from "@/server/transport/actions/budgets";
import { useActionForm } from "@/components/forms/use-action-form";
import { FieldError } from "@/components/forms/field-error";
import { NativeSelect } from "@/components/ui/native-select";
import { indentedName } from "@/components/transactions/category-tree";
import type { CategoryOption } from "@/components/categories/category-options";
import type { BudgetAccountOption } from "@/server/services/budgets";

export type BudgetLineOption = { id: string; name: string };
export type EditableBudgetLine = {
  kind: BudgetLineKind;
  categoryId: string | null;
  accountId: string | null;
  direction: TransferDirection | null;
  counterpartAccountId: string | null;
  label: string | null;
  plannedAmount: number;
};
export type EditableBudget = {
  id: string;
  name: string;
  description: string | null;
  groupId: string | null;
  accountId: string | null;
  outOfBudgetPlanned: number | null;
  periodType: string;
  periodStart: string; // YYYY-MM-DD
  periodEnd: string; // YYYY-MM-DD
  recurring: boolean;
  lines: EditableBudgetLine[];
};

type LineRow = {
  kind: BudgetLineKind;
  categoryId: string;
  accountId: string;
  direction: TransferDirection;
  counterpartAccountId: string;
  label: string;
  plannedAmount: string;
};

function blankLine(): LineRow {
  return {
    kind: "EXPENSE",
    categoryId: "",
    accountId: "",
    direction: "OUT",
    counterpartAccountId: "",
    label: "",
    plannedAmount: "",
  };
}

type FormProps = {
  mode: "create" | "edit";
  budget?: EditableBudget;
  categories: CategoryOption[];
  accounts: BudgetAccountOption[];
  groups: BudgetLineOption[];
};

export function BudgetForm({
  trigger,
  open: controlledOpen,
  onOpenChange,
  ...props
}: FormProps & {
  trigger?: React.ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const t = useTranslations("budgets");
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const open = controlledOpen ?? uncontrolledOpen;
  const setOpen = onOpenChange ?? setUncontrolledOpen;
  // Swapping Sheet↔Dialog mid-edit would remount the fields and lose the user's input.
  const isMobile = useFrozenWhileOpen(open, useIsMobile());

  const body = (
    <>
      <DialogHeader className="border-border shrink-0 border-b px-6 pt-5 pb-4 text-left max-md:px-5">
        <DialogTitle className="font-display text-2xl">
          {props.mode === "create" ? t("createTitle") : t("editTitle")}
        </DialogTitle>
        <DialogDescription>{t("subtitle")}</DialogDescription>
      </DialogHeader>
      <BudgetFormBody {...props} onDone={() => setOpen(false)} />
    </>
  );

  return isMobile ? (
    <Sheet open={open} onOpenChange={setOpen}>
      {trigger && <SheetTrigger render={trigger as React.ReactElement} />}
      <SheetContent
        side="bottom"
        className="flex max-h-[92dvh] flex-col gap-0 overflow-hidden rounded-t-2xl p-0"
      >
        {body}
      </SheetContent>
    </Sheet>
  ) : (
    <Dialog open={open} onOpenChange={setOpen}>
      {trigger && <DialogTrigger render={trigger as React.ReactElement} />}
      <DialogContent className="flex max-h-[90dvh] flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl">
        {body}
      </DialogContent>
    </Dialog>
  );
}

// Mounted with the dialog content, so a cancelled draft is gone on the next opening.
function BudgetFormBody({
  mode,
  budget,
  categories,
  accounts: allAccounts,
  groups,
  onDone,
}: FormProps & { onDone: () => void }) {
  const t = useTranslations("budgets");
  const locale = useLocale();
  const router = useRouter();
  const [groupId, setGroupId] = useState(budget?.groupId ?? "");
  const [periodType, setPeriodType] = useState<BudgetPeriodType>(
    (budget?.periodType as BudgetPeriodType) ?? "MONTH",
  );
  const [periodStart, setPeriodStart] = useState(budget?.periodStart ?? "");
  const [periodEnd, setPeriodEnd] = useState(budget?.periodEnd ?? "");
  const [accountId, setAccountId] = useState(budget?.accountId ?? "");
  const [margin, setMargin] = useState(
    budget?.outOfBudgetPlanned == null ? "" : formatAmountInput(budget.outOfBudgetPlanned, locale),
  );
  const [lines, setLines] = useState<LineRow[]>(
    budget?.lines.map((l) => ({
      kind: l.kind,
      categoryId: l.categoryId ?? "",
      accountId: l.accountId ?? "",
      direction: l.direction ?? "OUT",
      counterpartAccountId: l.counterpartAccountId ?? "",
      label: l.label ?? "",
      plannedAmount: formatAmountInput(l.plannedAmount, locale),
    })) ?? [blankLine()],
  );
  const attached = accountId !== "";

  const scopeCategories = groupId
    ? categories.filter((c) => c.groupId === null || c.groupId === groupId)
    : categories;
  const usedAccountIds = new Set([
    budget?.accountId,
    ...(budget?.lines.flatMap((l) => [l.accountId, l.counterpartAccountId]) ?? []),
  ]);
  const accounts = allAccounts.filter((a) => !a.archived || usedAccountIds.has(a.id));
  const scopeAccounts = groupId ? accounts.filter((a) => a.groupIds.includes(groupId)) : accounts;
  const accountLabel = (a: BudgetAccountOption) =>
    a.archived ? t("line.archivedAccount", { name: a.name }) : a.name;

  // An attached budget's planned total is its spending side plus the margin (design §D).
  const plannedTotal = useMemo(
    () =>
      budgetPlannedTotal([
        ...lines
          .filter((l) => !attached || lineFlow(l) === "out")
          .map((l) => ({ plannedAmount: parseAmount(l.plannedAmount) || 0 })),
        { plannedAmount: attached ? parseAmount(margin) || 0 : 0 },
      ]),
    [lines, attached, margin],
  );

  const linesPayload = JSON.stringify(
    lines.map((l) => ({
      kind: attached ? l.kind : "EXPENSE",
      categoryId: (!attached || l.kind !== "TRANSFER") && l.categoryId ? l.categoryId : undefined,
      accountId: !attached && l.accountId ? l.accountId : undefined,
      direction: attached && l.kind === "TRANSFER" ? l.direction : undefined,
      counterpartAccountId:
        attached && l.kind === "TRANSFER" && l.counterpartAccountId
          ? l.counterpartAccountId
          : undefined,
      label: l.label || undefined,
      plannedAmount: l.plannedAmount,
    })),
  );

  function updateLine(index: number, patch: Partial<LineRow>) {
    setLines((prev) => prev.map((l, i) => (i === index ? { ...l, ...patch } : l)));
  }

  // Without an account, lines go back to plain expense lines (design §F).
  function changeAccount(next: string) {
    setAccountId(next);
    if (!next) setMargin("");
    setLines((prev) =>
      prev.map((l) =>
        next
          ? {
              ...l,
              accountId: "",
              counterpartAccountId: l.counterpartAccountId === next ? "" : l.counterpartAccountId,
            }
          : { ...l, kind: "EXPENSE", counterpartAccountId: "" },
      ),
    );
  }

  function changeScope(next: string) {
    setGroupId(next);
    const accountIds = new Set(
      (next ? accounts.filter((a) => a.groupIds.includes(next)) : accounts).map((a) => a.id),
    );
    if (accountId && !accountIds.has(accountId)) changeAccount("");
    const categoryIds = new Set(
      categories.filter((c) => !next || c.groupId === null || c.groupId === next).map((c) => c.id),
    );
    setLines((prev) =>
      prev.map((l) => ({
        ...l,
        accountId: accountIds.has(l.accountId) ? l.accountId : "",
        counterpartAccountId: accountIds.has(l.counterpartAccountId) ? l.counterpartAccountId : "",
        categoryId: categoryIds.has(l.categoryId) ? l.categoryId : "",
      })),
    );
  }

  // Typed periods derive their end from the start; editing the end by hand
  // turns the period into a custom one.
  function changePeriod(type: BudgetPeriodType, start: string) {
    setPeriodType(type);
    setPeriodStart(start);
    const end = periodEndFor(type, start);
    if (end) setPeriodEnd(end);
  }

  function changeEnd(end: string) {
    setPeriodEnd(end);
    if (periodType !== "CUSTOM" && periodStart && periodEndFor(periodType, periodStart) !== end) {
      setPeriodType("CUSTOM");
    }
  }

  const form = useActionForm(mode === "create" ? createBudgetAction : updateBudgetAction, {
    onSuccess: () => {
      onDone();
      router.refresh();
    },
  });

  return (
    <form {...form.formProps} className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-6 py-5 max-md:px-5">
        {mode === "edit" && <input type="hidden" name="id" value={budget!.id} />}
        <input type="hidden" name="lines" value={linesPayload} />

        <div className="space-y-2">
          <Label htmlFor="bud-name">{t("name")}</Label>
          <Input
            id="bud-name"
            name="name"
            defaultValue={budget?.name}
            placeholder={t("namePlaceholder")}
            required
            maxLength={BUDGET_NAME_MAX}
            {...form.fieldProps("name")}
          />
          <FieldError form={form} name="name" />
        </div>

        <div className="space-y-2">
          <Label htmlFor="bud-description">{t("description")}</Label>
          <textarea
            id="bud-description"
            name="description"
            defaultValue={budget?.description ?? ""}
            placeholder={t("descriptionPlaceholder")}
            maxLength={BUDGET_DESCRIPTION_MAX}
            rows={2}
            {...form.fieldProps("description")}
            className="border-input placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:border-destructive w-full rounded-lg border bg-transparent px-2.5 py-1.5 text-base outline-none focus-visible:ring-3 md:text-sm"
          />
          <FieldError form={form} name="description" />
        </div>

        <div className="space-y-2">
          <Label htmlFor="bud-scope">{t("scope")}</Label>
          <NativeSelect
            id="bud-scope"
            name="groupId"
            value={groupId}
            onChange={(e) => changeScope(e.target.value)}
            disabled={mode === "edit"}
          >
            <option value="">{t("scopePersonal")}</option>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </NativeSelect>
        </div>

        <div className="space-y-2">
          <Label htmlFor="bud-account">{t("account.label")}</Label>
          <NativeSelect
            id="bud-account"
            name="accountId"
            value={accountId}
            onChange={(e) => changeAccount(e.target.value)}
          >
            <option value="">{t("account.none")}</option>
            {scopeAccounts.map((a) => (
              <option key={a.id} value={a.id}>
                {accountLabel(a)}
              </option>
            ))}
          </NativeSelect>
          {attached && <p className="text-muted-foreground text-xs">{t("account.hint")}</p>}
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="space-y-2">
            <Label htmlFor="bud-period-type">{t("period")}</Label>
            <NativeSelect
              id="bud-period-type"
              name="periodType"
              value={periodType}
              onChange={(e) => changePeriod(e.target.value as BudgetPeriodType, periodStart)}
            >
              {BUDGET_PERIOD_TYPES.map((p) => (
                <option key={p} value={p}>
                  {t(`periodType.${p}`)}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="space-y-2">
            <Label htmlFor="bud-start">{t("periodStart")}</Label>
            <Input
              id="bud-start"
              name="periodStart"
              type="date"
              value={periodStart}
              onChange={(e) => changePeriod(periodType, e.target.value)}
              required
              {...form.fieldProps("periodStart")}
            />
            <FieldError form={form} name="periodStart" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="bud-end">{t("periodEnd")}</Label>
            <Input
              id="bud-end"
              name="periodEnd"
              type="date"
              value={periodEnd}
              onChange={(e) => changeEnd(e.target.value)}
              required
              {...form.fieldProps("periodEnd")}
            />
            <FieldError form={form} name="periodEnd" />
          </div>
        </div>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            name="recurring"
            defaultChecked={budget?.recurring ?? false}
            className="border-input size-4 rounded border"
          />
          {t("recurring")}
        </label>

        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <Label>{t("lines")}</Label>
            <span className="text-muted-foreground text-sm tabular-nums">
              {t("plannedTotalValue", { amount: formatMoney(plannedTotal, locale) })}
            </span>
          </div>

          {lines.map((line, i) => (
            <div
              key={i}
              data-slot="budget-line-row"
              className={`border-border grid grid-cols-1 gap-2 rounded-md border p-3 ${
                attached ? "sm:grid-cols-[auto_1fr_auto_auto]" : "sm:grid-cols-[1fr_1fr_auto_auto]"
              }`}
            >
              <Input
                aria-label={t("line.label")}
                placeholder={t("line.labelPlaceholder")}
                value={line.label}
                onChange={(e) => updateLine(i, { label: e.target.value })}
                maxLength={BUDGET_LINE_LABEL_MAX}
                className="sm:col-span-4"
                data-field={`lines.${i}.label`}
                {...form.fieldProps(`lines.${i}.label`)}
              />
              {attached && (
                <NativeSelect
                  aria-label={t("line.kindLabel")}
                  value={line.kind}
                  onChange={(e) => updateLine(i, { kind: e.target.value as BudgetLineKind })}
                >
                  {BUDGET_LINE_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {t(`line.kind.${k}`)}
                    </option>
                  ))}
                </NativeSelect>
              )}
              {attached && line.kind === "TRANSFER" ? (
                <div className="grid grid-cols-[auto_1fr] gap-2">
                  <NativeSelect
                    aria-label={t("line.directionLabel")}
                    value={line.direction}
                    onChange={(e) =>
                      updateLine(i, { direction: e.target.value as TransferDirection })
                    }
                  >
                    {TRANSFER_DIRECTIONS.map((d) => (
                      <option key={d} value={d}>
                        {t(`line.direction.${d}`)}
                      </option>
                    ))}
                  </NativeSelect>
                  <NativeSelect
                    aria-label={t("line.counterpart")}
                    value={line.counterpartAccountId}
                    onChange={(e) => updateLine(i, { counterpartAccountId: e.target.value })}
                    {...form.fieldProps(`lines.${i}.counterpartAccountId`)}
                  >
                    <option value="">{t("line.chooseAccount")}</option>
                    {scopeAccounts
                      .filter((a) => a.id !== accountId)
                      .map((a) => (
                        <option key={a.id} value={a.id}>
                          {accountLabel(a)}
                        </option>
                      ))}
                  </NativeSelect>
                </div>
              ) : (
                <NativeSelect
                  aria-label={t("line.category")}
                  value={line.categoryId}
                  onChange={(e) => updateLine(i, { categoryId: e.target.value })}
                  {...form.fieldProps(`lines.${i}.categoryId`)}
                >
                  <option value="">
                    {attached ? t("line.chooseCategory") : t("line.anyCategory")}
                  </option>
                  {scopeCategories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {indentedName(c.name, c.depth)}
                    </option>
                  ))}
                </NativeSelect>
              )}
              {!attached && (
                <NativeSelect
                  aria-label={t("line.account")}
                  value={line.accountId}
                  onChange={(e) => updateLine(i, { accountId: e.target.value })}
                >
                  <option value="">{t("line.anyAccount")}</option>
                  {scopeAccounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {accountLabel(a)}
                    </option>
                  ))}
                </NativeSelect>
              )}
              <Input
                name="plannedAmount"
                type="text"
                inputMode="decimal"
                placeholder={formatAmountInput(0, locale)}
                aria-label={t("line.planned")}
                value={line.plannedAmount}
                onChange={(e) => updateLine(i, { plannedAmount: e.target.value })}
                onBlur={(e) => {
                  const r = readAmount(e.target.value);
                  if (r.ok) updateLine(i, { plannedAmount: formatAmountInput(r.value, locale) });
                }}
                className="sm:w-28"
                required
                data-field={`lines.${i}.plannedAmount`}
                {...form.fieldProps(`lines.${i}.plannedAmount`)}
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={t("line.remove")}
                disabled={lines.length === 1}
                onClick={() => {
                  setLines((prev) => prev.filter((_, j) => j !== i));
                  form.clearFieldErrors((name) => name.startsWith("lines."));
                }}
              >
                <X />
              </Button>
              <div className="empty:hidden sm:col-span-4">
                <FieldError form={form} name={`lines.${i}.plannedAmount`} />
                <FieldError form={form} name={`lines.${i}.categoryId`} />
                <FieldError form={form} name={`lines.${i}.counterpartAccountId`} />
              </div>
            </div>
          ))}
          {attached && (
            <div
              data-slot="budget-margin-row"
              className="border-border grid grid-cols-1 items-center gap-2 rounded-md border border-dashed p-3 sm:grid-cols-[1fr_auto]"
            >
              <div>
                <Label htmlFor="bud-margin">{t("outOfBudget.label")}</Label>
                <p className="text-muted-foreground text-xs">{t("outOfBudget.marginHint")}</p>
              </div>
              <Input
                id="bud-margin"
                name="outOfBudgetPlanned"
                type="text"
                inputMode="decimal"
                placeholder={t("outOfBudget.margin")}
                aria-label={t("outOfBudget.margin")}
                value={margin}
                onChange={(e) => setMargin(e.target.value)}
                onBlur={(e) => {
                  const r = readAmount(e.target.value);
                  if (r.ok && e.target.value.trim()) setMargin(formatAmountInput(r.value, locale));
                }}
                className="sm:w-40"
                {...form.fieldProps("outOfBudgetPlanned")}
              />
              <div className="empty:hidden sm:col-span-2">
                <FieldError form={form} name="outOfBudgetPlanned" />
              </div>
            </div>
          )}
          <p className="text-muted-foreground text-xs">
            {attached ? t("line.attachedHint") : t("line.catchAllHint")}
          </p>

          <Button
            type="button"
            variant="outline"
            onClick={() => setLines((prev) => [...prev, blankLine()])}
          >
            <Plus />
            {t("line.add")}
          </Button>
        </div>

        {form.error && (
          <p role="alert" className="text-destructive text-sm">
            {t(`error.${form.error}`)}
          </p>
        )}
      </div>

      <DialogFooter className="bg-muted/40 border-border shrink-0 border-t px-6 py-3 max-md:px-5">
        <Button type="button" variant="ghost" onClick={onDone}>
          {t("cancel")}
        </Button>
        <Button type="submit" disabled={form.pending}>
          <Check />
          {form.pending ? t("saving") : mode === "create" ? t("createCta") : t("save")}
        </Button>
      </DialogFooter>
    </form>
  );
}

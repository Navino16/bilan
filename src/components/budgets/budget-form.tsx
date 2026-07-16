"use client";

import { useMemo, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
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
import { budgetPlannedTotal } from "@/lib/budgets";
import { BUDGET_PERIOD_TYPES } from "@/lib/validation/budget";
import {
  createBudgetAction,
  updateBudgetAction,
  type BudgetActionState,
} from "@/server/transport/actions/budgets";

export type BudgetLineOption = { id: string; name: string };
export type EditableBudgetLine = {
  categoryId: string | null;
  accountId: string | null;
  label: string | null;
  plannedAmount: number;
};
export type EditableBudget = {
  id: string;
  name: string;
  description: string | null;
  groupId: string | null;
  periodType: string;
  periodStart: string; // YYYY-MM-DD
  periodEnd: string; // YYYY-MM-DD
  recurring: boolean;
  lines: EditableBudgetLine[];
};

type LineRow = {
  categoryId: string;
  accountId: string;
  label: string;
  plannedAmount: string;
};

function blankLine(): LineRow {
  return { categoryId: "", accountId: "", label: "", plannedAmount: "" };
}

export function BudgetForm({
  mode,
  budget,
  categories,
  accounts,
  groups,
  trigger,
  open: controlledOpen,
  onOpenChange,
}: {
  mode: "create" | "edit";
  budget?: EditableBudget;
  categories: BudgetLineOption[];
  accounts: BudgetLineOption[];
  groups: BudgetLineOption[];
  trigger?: React.ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const t = useTranslations("budgets");
  const router = useRouter();
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const open = controlledOpen ?? uncontrolledOpen;
  const setOpen = onOpenChange ?? setUncontrolledOpen;
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [lines, setLines] = useState<LineRow[]>(
    budget?.lines.map((l) => ({
      categoryId: l.categoryId ?? "",
      accountId: l.accountId ?? "",
      label: l.label ?? "",
      plannedAmount: String(l.plannedAmount),
    })) ?? [blankLine()],
  );

  const plannedTotal = useMemo(
    () => budgetPlannedTotal(lines.map((l) => ({ plannedAmount: Number(l.plannedAmount) || 0 }))),
    [lines],
  );

  const linesPayload = useMemo(
    () =>
      JSON.stringify(
        lines.map((l) => ({
          categoryId: l.categoryId || undefined,
          accountId: l.accountId || undefined,
          label: l.label || undefined,
          plannedAmount: Number(l.plannedAmount) || 0,
        })),
      ),
    [lines],
  );

  function updateLine(index: number, patch: Partial<LineRow>) {
    setLines((prev) => prev.map((l, i) => (i === index ? { ...l, ...patch } : l)));
  }

  function handleAction(formData: FormData) {
    startTransition(async () => {
      const act = mode === "create" ? createBudgetAction : updateBudgetAction;
      const result: BudgetActionState = await act(null, formData);
      if (result?.ok) {
        setError(null);
        setOpen(false);
        if (mode === "create") setLines([blankLine()]);
        router.refresh();
      } else {
        setError(result?.error ?? "FAILED");
      }
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setError(null);
      }}
    >
      {trigger && <DialogTrigger render={trigger as React.ReactElement} />}
      <DialogContent className="flex max-h-[90dvh] flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="border-border shrink-0 border-b px-6 pt-5 pb-4 text-left">
          <DialogTitle className="font-display text-2xl">
            {mode === "create" ? t("createTitle") : t("editTitle")}
          </DialogTitle>
          <DialogDescription>{t("period")}</DialogDescription>
        </DialogHeader>

        <form action={handleAction} className="flex min-h-0 flex-1 flex-col">
          <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-6 py-5">
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
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="bud-scope">{t("scope")}</Label>
              <select
                id="bud-scope"
                name="groupId"
                defaultValue={budget?.groupId ?? ""}
                disabled={mode === "edit"}
                className="border-input bg-background h-9 w-full rounded-md border px-3 text-sm"
              >
                <option value="">{t("scopePersonal")}</option>
                {groups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div className="space-y-2">
                <Label htmlFor="bud-period-type">{t("period")}</Label>
                <select
                  id="bud-period-type"
                  name="periodType"
                  defaultValue={budget?.periodType ?? "MONTH"}
                  className="border-input bg-background h-9 w-full rounded-md border px-3 text-sm"
                >
                  {BUDGET_PERIOD_TYPES.map((p) => (
                    <option key={p} value={p}>
                      {t(`periodType.${p}`)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="bud-start">{t("periodStart")}</Label>
                <Input
                  id="bud-start"
                  name="periodStart"
                  type="date"
                  defaultValue={budget?.periodStart}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="bud-end">{t("periodEnd")}</Label>
                <Input
                  id="bud-end"
                  name="periodEnd"
                  type="date"
                  defaultValue={budget?.periodEnd}
                  required
                />
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
                <span className="text-muted-foreground text-sm">
                  {t("plannedTotal")}: {plannedTotal.toFixed(2)}
                </span>
              </div>

              {lines.map((line, i) => (
                <div
                  key={i}
                  className="border-border grid grid-cols-1 gap-2 rounded-md border p-3 sm:grid-cols-[1fr_1fr_auto_auto]"
                >
                  <select
                    aria-label={t("line.category")}
                    value={line.categoryId}
                    onChange={(e) => updateLine(i, { categoryId: e.target.value })}
                    className="border-input bg-background h-9 w-full rounded-md border px-3 text-sm"
                  >
                    <option value="">{t("line.any")}</option>
                    {categories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                  <select
                    aria-label={t("line.account")}
                    value={line.accountId}
                    onChange={(e) => updateLine(i, { accountId: e.target.value })}
                    className="border-input bg-background h-9 w-full rounded-md border px-3 text-sm"
                  >
                    <option value="">{t("line.any")}</option>
                    {accounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                  </select>
                  <Input
                    name="plannedAmount"
                    type="number"
                    step="0.01"
                    min="0"
                    inputMode="decimal"
                    placeholder={t("line.planned")}
                    aria-label={t("line.planned")}
                    value={line.plannedAmount}
                    onChange={(e) => updateLine(i, { plannedAmount: e.target.value })}
                    className="sm:w-28"
                    required
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={t("line.remove")}
                    disabled={lines.length === 1}
                    onClick={() => setLines((prev) => prev.filter((_, j) => j !== i))}
                  >
                    <X />
                  </Button>
                </div>
              ))}

              <Button
                type="button"
                variant="outline"
                onClick={() => setLines((prev) => [...prev, blankLine()])}
              >
                <Plus />
                {t("line.add")}
              </Button>
            </div>

            {error && <p className="text-destructive text-sm">{t(`error.${error}`)}</p>}
          </div>

          <DialogFooter className="bg-muted/40 border-border shrink-0 border-t px-6 py-3">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              {t("cancel")}
            </Button>
            <Button type="submit" disabled={pending}>
              <Check />
              {pending ? t("saving") : mode === "create" ? t("createCta") : t("save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

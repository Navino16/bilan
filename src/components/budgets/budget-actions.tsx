"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { Archive, ArchiveRestore, MoreVertical, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { archiveBudgetAction, unarchiveBudgetAction } from "@/server/transport/actions/budgets";
import {
  BudgetForm,
  type BudgetLineOption,
  type EditableBudget,
  type EditableBudgetLine,
} from "./budget-form";
import { BudgetDeleteDialog } from "./budget-delete-dialog";
import type { CategoryOption } from "@/components/categories/category-options";
import type { BudgetAccountOption } from "@/server/services/budgets";

export type BudgetFormOptions = {
  categories: CategoryOption[];
  accounts: BudgetAccountOption[];
  groups: BudgetLineOption[];
};

type Dialogs = "edit" | "archive" | "delete" | null;

// Edit / archive / delete menu of a budget; an archived one can only be unarchived
// or deleted. `afterDelete` defaults to refreshing the page.
export function BudgetActions({
  budget,
  archived = false,
  options,
  afterDelete,
}: {
  budget: EditableBudget;
  archived?: boolean;
  options: BudgetFormOptions;
  afterDelete?: () => void;
}) {
  const t = useTranslations("budgets");
  const router = useRouter();
  const [open, setOpen] = useState<Dialogs>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function setArchived(next: boolean) {
    const fd = new FormData();
    fd.set("id", budget.id);
    setError(null);
    startTransition(async () => {
      const res = await (next ? archiveBudgetAction : unarchiveBudgetAction)(null, fd);
      if (!res?.ok) return setError(res?.error === "FORBIDDEN" ? "FORBIDDEN" : "FAILED");
      setOpen(null);
      router.refresh();
    });
  }

  function openDialog(dialog: Dialogs) {
    setError(null);
    setOpen(dialog);
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              className="text-muted-foreground"
              aria-label={t("actionsFor", { name: budget.name })}
              disabled={pending}
            />
          }
        >
          <MoreVertical />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-44">
          {archived ? (
            <DropdownMenuItem onClick={() => setArchived(false)}>
              <ArchiveRestore />
              {t("unarchive")}
            </DropdownMenuItem>
          ) : (
            <>
              <DropdownMenuItem onClick={() => openDialog("edit")}>
                <Pencil />
                {t("edit")}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => openDialog("archive")}>
                <Archive />
                {t("archive")}
              </DropdownMenuItem>
            </>
          )}
          <DropdownMenuItem variant="destructive" onClick={() => openDialog("delete")}>
            <Trash2 />
            {t("delete")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {error && open === null && (
        <span role="alert" className="text-destructive text-xs">
          {t(`error.${error}`)}
        </span>
      )}
      {!archived && (
        <BudgetForm
          mode="edit"
          budget={budget}
          {...options}
          open={open === "edit"}
          onOpenChange={(next) => setOpen(next ? "edit" : null)}
        />
      )}
      {open === "archive" && (
        <Dialog open onOpenChange={(next) => !next && !pending && setOpen(null)}>
          <DialogContent data-slot="budget-archive-dialog">
            <DialogHeader>
              <DialogTitle>{t("archiveTitle", { name: budget.name })}</DialogTitle>
              <DialogDescription>{t("archiveBody")}</DialogDescription>
            </DialogHeader>
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{t(`error.${error}`)}</AlertDescription>
              </Alert>
            )}
            <DialogFooter>
              <DialogClose render={<Button variant="ghost" type="button" disabled={pending} />}>
                {t("cancel")}
              </DialogClose>
              <Button onClick={() => setArchived(true)} disabled={pending}>
                <Archive />
                {t("archive")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
      {open === "delete" && (
        <BudgetDeleteDialog
          budget={budget}
          onClose={() => setOpen(null)}
          onDeleted={() => {
            setOpen(null);
            if (afterDelete) afterDelete();
            else router.refresh();
          }}
        />
      )}
    </>
  );
}

const isoDay = (d: Date) => d.toISOString().slice(0, 10);

export function toEditableBudget(b: {
  id: string;
  name: string;
  description: string | null;
  groupId: string | null;
  accountId: string | null;
  outOfBudgetPlanned: number | null;
  periodType: string;
  periodStart: Date;
  periodEnd: Date;
  recurring: boolean;
  lines: (EditableBudgetLine & { mirrorOf?: unknown })[];
}): EditableBudget {
  return {
    id: b.id,
    name: b.name,
    description: b.description,
    groupId: b.groupId,
    accountId: b.accountId,
    outOfBudgetPlanned: b.outOfBudgetPlanned,
    periodType: b.periodType,
    periodStart: isoDay(b.periodStart),
    periodEnd: isoDay(b.periodEnd),
    recurring: b.recurring,
    lines: b.lines
      .filter((l) => !l.mirrorOf)
      .map((l) => ({
        kind: l.kind,
        categoryId: l.categoryId,
        accountId: l.accountId,
        direction: l.direction,
        counterpartAccountId: l.counterpartAccountId,
        label: l.label,
        plannedAmount: l.plannedAmount,
      })),
  };
}

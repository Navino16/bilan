"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { MoreVertical, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { BudgetForm, type BudgetLineOption, type EditableBudget } from "./budget-form";
import { BudgetDeleteDialog } from "./budget-delete-dialog";
import type { CategoryOption } from "@/components/categories/category-options";
import type { BudgetAccountOption } from "@/server/services/budgets";

export type BudgetFormOptions = {
  categories: CategoryOption[];
  accounts: BudgetAccountOption[];
  groups: BudgetLineOption[];
};

// Edit / delete menu of a budget; `afterDelete` defaults to refreshing the page.
export function BudgetActions({
  budget,
  options,
  afterDelete,
}: {
  budget: EditableBudget;
  options: BudgetFormOptions;
  afterDelete?: () => void;
}) {
  const t = useTranslations("budgets");
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);

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
            />
          }
        >
          <MoreVertical />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-40">
          <DropdownMenuItem onClick={() => setEditing(true)}>
            <Pencil />
            {t("edit")}
          </DropdownMenuItem>
          <DropdownMenuItem variant="destructive" onClick={() => setDeleting(true)}>
            <Trash2 />
            {t("delete")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <BudgetForm
        mode="edit"
        budget={budget}
        {...options}
        open={editing}
        onOpenChange={setEditing}
      />
      {deleting && (
        <BudgetDeleteDialog
          budget={budget}
          onClose={() => setDeleting(false)}
          onDeleted={() => {
            setDeleting(false);
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
  periodType: string;
  periodStart: Date;
  periodEnd: Date;
  recurring: boolean;
  lines: {
    categoryId: string | null;
    accountId: string | null;
    label: string | null;
    plannedAmount: number;
  }[];
}): EditableBudget {
  return {
    id: b.id,
    name: b.name,
    description: b.description,
    groupId: b.groupId,
    periodType: b.periodType,
    periodStart: isoDay(b.periodStart),
    periodEnd: isoDay(b.periodEnd),
    recurring: b.recurring,
    lines: b.lines.map((l) => ({
      categoryId: l.categoryId,
      accountId: l.accountId,
      label: l.label,
      plannedAmount: l.plannedAmount,
    })),
  };
}

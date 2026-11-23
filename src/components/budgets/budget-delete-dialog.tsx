"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { deleteBudgetAction } from "@/server/transport/actions/budgets";

// Mount it only while open.
export function BudgetDeleteDialog({
  budget,
  onClose,
  onDeleted,
}: {
  budget: { id: string; name: string };
  onClose: () => void;
  onDeleted: () => void;
}) {
  const t = useTranslations("budgets");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function confirm() {
    const fd = new FormData();
    fd.set("id", budget.id);
    startTransition(async () => {
      const res = await deleteBudgetAction(null, fd);
      if (!res?.ok) return setError(res?.error === "FORBIDDEN" ? "FORBIDDEN" : "FAILED");
      onDeleted();
    });
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !pending && onClose()}>
      <DialogContent data-slot="budget-delete-dialog">
        <DialogHeader>
          <DialogTitle>{t("deleteTitle", { name: budget.name })}</DialogTitle>
          <DialogDescription>{t("deleteBody")}</DialogDescription>
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
          <Button variant="destructive" onClick={confirm} disabled={pending}>
            {t("delete")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

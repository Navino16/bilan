"use client";

import { useEffect, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  deleteCategoryAction,
  getCategoryDeletionImpactAction,
} from "@/server/transport/actions/categories";
import type { CategoryDeletionImpact } from "@/server/services/categories";
import { indentedName } from "@/components/transactions/category-tree";
import type { CategoryOption } from "./category-options";

const IMPACT_KEYS = ["subcategories", "transactions", "rules", "budgetLines"] as const;

// Mount it only while open: the impact is loaded fresh on each opening.
export function CategoryDeleteDialog({
  category,
  targets,
  onClose,
}: {
  category: { id: string; name: string; parentId: string | null };
  targets: CategoryOption[];
  onClose: () => void;
}) {
  const t = useTranslations("categories.deleteDialog");
  const tc = useTranslations("categories");
  const router = useRouter();
  const [impact, setImpact] = useState<CategoryDeletionImpact | null>(null);
  const [targetId, setTargetId] = useState(
    targets.some((c) => c.id === category.parentId) ? category.parentId! : "",
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    let live = true;
    getCategoryDeletionImpactAction(category.id)
      .then((res) => {
        if (!live) return;
        if (res.ok) setImpact(res.impact);
        else setError(res.error);
      })
      .catch(() => live && setError("FAILED"));
    return () => {
      live = false;
    };
  }, [category.id]);

  function confirm() {
    const fd = new FormData();
    fd.set("id", category.id);
    fd.set("targetId", targetId);
    startTransition(async () => {
      const res = await deleteCategoryAction(null, fd);
      if (!res?.ok) return setError(res?.error ?? "FAILED");
      onClose();
      router.refresh();
    });
  }

  const usages = impact ? IMPACT_KEYS.filter((k) => impact[k] > 0) : [];
  const reassignable = impact ? impact.transactions + impact.rules + impact.budgetLines > 0 : false;
  const target = targets.find((c) => c.id === targetId);

  return (
    <Dialog open onOpenChange={(open) => !open && !pending && onClose()}>
      <DialogContent data-slot="category-delete-dialog">
        <DialogHeader>
          <DialogTitle>{t("title", { name: category.name })}</DialogTitle>
          <DialogDescription>
            {impact ? (usages.length > 0 ? t("usedBy") : t("unused")) : !error && t("loading")}
          </DialogDescription>
        </DialogHeader>
        {usages.length > 0 && (
          <ul className="list-disc space-y-1 pl-5 text-sm">
            {usages.map((k) => (
              <li key={k}>{t(k, { count: impact![k] })}</li>
            ))}
          </ul>
        )}
        {reassignable && (
          <div className="space-y-2">
            <Label htmlFor="cat-delete-target">{t("moveTo")}</Label>
            <NativeSelect
              id="cat-delete-target"
              value={targetId}
              onChange={(e) => setTargetId(e.target.value)}
            >
              <option value="">{t("noTarget")}</option>
              {targets.map((c) => (
                <option key={c.id} value={c.id}>
                  {indentedName(c.name, c.depth)}
                </option>
              ))}
            </NativeSelect>
            <p className="text-muted-foreground text-xs">
              {target ? t("outcomeMove", { name: target.name }) : t("outcomeNone")}
            </p>
          </div>
        )}
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{tc(`error.${error}`)}</AlertDescription>
          </Alert>
        )}
        <DialogFooter>
          <DialogClose render={<Button variant="ghost" type="button" disabled={pending} />}>
            {tc("cancel")}
          </DialogClose>
          <Button variant="destructive" onClick={confirm} disabled={!impact || pending}>
            {tc("delete")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

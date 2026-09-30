"use client";

import { useEffect, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { TriangleAlert } from "lucide-react";
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
import {
  deleteTransactionsAction,
  getDeleteImpactAction,
} from "@/server/transport/actions/transactions";
import type { DeleteImpact } from "@/server/services/transactions/delete";

type ErrorKey = "INVALID" | "NOT_FOUND" | "FORBIDDEN" | "FAILED";
const errorKey = (e: string): ErrorKey =>
  (["INVALID", "NOT_FOUND", "FORBIDDEN"] as const).find((k) => k === e) ?? "FAILED";

// Mount it only while open: the impact is loaded fresh on each opening.
export function DeleteTransactionsDialog({
  ids,
  onClose,
  onDeleted,
}: {
  ids: string[];
  onClose: () => void;
  onDeleted: () => void;
}) {
  const t = useTranslations("transactions.delete");
  const router = useRouter();
  const [impact, setImpact] = useState<DeleteImpact | null>(null);
  const [error, setError] = useState<ErrorKey | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    let live = true;
    void getDeleteImpactAction(ids).then((res) => {
      if (!live) return;
      if (res.ok) setImpact(res.data);
      else setError(errorKey(res.error));
    });
    return () => {
      live = false;
    };
  }, [ids]);

  function confirm() {
    startTransition(async () => {
      const res = await deleteTransactionsAction(ids);
      if (!res.ok) return setError(errorKey(res.error));
      onDeleted();
      router.refresh();
    });
  }

  const extras = impact
    ? (["dissolvedLinks", "leavingLink", "budgeted"] as const).filter((k) => impact[k] > 0)
    : [];

  return (
    <Dialog open onOpenChange={(open) => !open && !pending && onClose()}>
      <DialogContent data-slot="delete-transactions-dialog">
        <DialogHeader>
          <DialogTitle>{t("title", { count: ids.length })}</DialogTitle>
          <DialogDescription>
            {impact ? t("deleted", { count: impact.transactions }) : !error && t("loading")}
          </DialogDescription>
        </DialogHeader>
        {impact && extras.length > 0 && (
          <ul className="space-y-1.5 text-sm">
            {extras.map((k) => (
              <li key={k} className="flex items-start gap-2">
                <TriangleAlert className="text-destructive mt-0.5 size-3.5 shrink-0" />
                {t(k, { count: impact[k] })}
              </li>
            ))}
          </ul>
        )}
        {impact && <p className="text-muted-foreground text-xs">{t("irreversible")}</p>}
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{t(`error.${error}`)}</AlertDescription>
          </Alert>
        )}
        <DialogFooter>
          <DialogClose render={<Button variant="ghost" type="button" disabled={pending} />}>
            {t("keep")}
          </DialogClose>
          <Button variant="destructive" onClick={confirm} disabled={!impact || pending}>
            {t("confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

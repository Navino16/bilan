"use client";

import { useEffect, useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
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
import { getRevertImpactAction, revertImportAction } from "@/server/transport/actions/imports";
import type { RevertImpact } from "@/server/services/imports/revert";

type ErrorKey = "NOT_REVERTIBLE" | "NOT_FOUND" | "FORBIDDEN" | "FAILED";
const errorKey = (e: string): ErrorKey =>
  (["NOT_REVERTIBLE", "NOT_FOUND", "FORBIDDEN"] as const).find((k) => k === e) ?? "FAILED";

// Mount it only while open: the impact is loaded fresh on each opening.
export function RevertImportDialog({
  batchId,
  onClose,
  onReverted,
}: {
  batchId: string;
  onClose: () => void;
  onReverted?: (deleted: number) => void;
}) {
  const t = useTranslations("import.revert");
  const money = new Intl.NumberFormat(useLocale(), { style: "currency", currency: "EUR" });
  const router = useRouter();
  const [impact, setImpact] = useState<RevertImpact | null>(null);
  const [error, setError] = useState<ErrorKey | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    let live = true;
    void getRevertImpactAction(batchId).then((res) => {
      if (!live) return;
      if (res.ok) setImpact(res.data);
      else setError(errorKey(res.error));
    });
    return () => {
      live = false;
    };
  }, [batchId]);

  function confirm() {
    startTransition(async () => {
      const res = await revertImportAction(batchId);
      if (!res.ok) return setError(errorKey(res.error));
      onReverted?.(res.data.deleted);
      onClose();
      router.refresh();
    });
  }

  const extras = impact
    ? (["linked", "budgeted", "edited"] as const).filter((k) => impact[k] > 0)
    : [];

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent data-slot="revert-import-dialog">
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>
            {impact ? t("deleted", { count: impact.transactions }) : t("loading")}
          </DialogDescription>
        </DialogHeader>
        {impact && impact.balances.length > 0 && (
          <ul className="space-y-1.5 text-sm">
            {impact.balances.map((b) => (
              <li key={b.accountName}>
                {b.restore
                  ? t("balanceRestore", {
                      account: b.accountName,
                      amount: money.format(b.previous),
                    })
                  : t("balanceKept", { account: b.accountName })}
              </li>
            ))}
          </ul>
        )}
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
          <DialogClose render={<Button variant="ghost" type="button" />}>{t("keep")}</DialogClose>
          <Button variant="destructive" onClick={confirm} disabled={!impact || pending}>
            {t("confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

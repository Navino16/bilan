"use client";

import { useEffect, useState, useTransition, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  deleteAccountAction,
  getAccountDeleteImpactAction,
} from "@/server/transport/actions/accounts";
import type { AccountDeleteImpact } from "@/server/services/accounts/delete";
import { confirmsAccountName } from "@/lib/validation/account";

type ErrorKey = "CONFIRMATION" | "FORBIDDEN" | "FAILED";
const errorKey = (e: string): ErrorKey =>
  (["CONFIRMATION", "FORBIDDEN"] as const).find((k) => k === e) ?? "FAILED";

// Mount it only while open: the impact is loaded fresh on each opening.
export function AccountDeleteDialog({
  account,
  onClose,
}: {
  account: { id: string; name: string };
  onClose: () => void;
}) {
  const t = useTranslations("accounts");
  const router = useRouter();
  const [impact, setImpact] = useState<AccountDeleteImpact | null>(null);
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<ErrorKey | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    let live = true;
    void getAccountDeleteImpactAction(account.id).then((res) => {
      if (!live) return;
      if (res.ok) setImpact(res.data);
      else setError(errorKey(res.error));
    });
    return () => {
      live = false;
    };
  }, [account.id]);

  function confirm(e: FormEvent) {
    e.preventDefault();
    const fd = new FormData();
    fd.set("id", account.id);
    fd.set("confirmName", typed);
    startTransition(async () => {
      const res = await deleteAccountAction(null, fd);
      if (!res?.ok) return setError(errorKey(res?.error ?? "FAILED"));
      onClose();
      router.refresh();
    });
  }

  const warnings = impact
    ? [
        ...(impact.imports > 0 ? [t("deleteDialog.imports", { count: impact.imports })] : []),
        ...(impact.sharedWith.length > 0
          ? [t("deleteDialog.sharedWith", { groups: impact.sharedWith.join(", ") })]
          : []),
        ...(impact.budgetLines > 0
          ? [t("deleteDialog.budgetLines", { count: impact.budgetLines })]
          : []),
        ...(impact.emptiedBudgets.length > 0
          ? [
              t("deleteDialog.emptiedBudgets", {
                count: impact.emptiedBudgets.length,
                names: impact.emptiedBudgets.join(", "),
              }),
            ]
          : []),
        ...(impact.dissolvedLinks > 0
          ? [t("deleteDialog.dissolvedLinks", { count: impact.dissolvedLinks })]
          : []),
      ]
    : [];
  const matches = !!impact && confirmsAccountName(typed, impact.name);

  return (
    <Dialog open onOpenChange={(open) => !open && !pending && onClose()}>
      <DialogContent data-slot="account-delete-dialog">
        <form onSubmit={confirm} className="space-y-4">
          <DialogHeader>
            <DialogTitle>{t("deleteDialog.title", { name: account.name })}</DialogTitle>
            <DialogDescription>
              {impact
                ? t("deleteDialog.transactions", { count: impact.transactions })
                : t("deleteDialog.loading")}
            </DialogDescription>
          </DialogHeader>
          {warnings.length > 0 && (
            <ul className="space-y-1.5 text-sm">
              {warnings.map((w) => (
                <li key={w} className="flex items-start gap-2">
                  <TriangleAlert className="text-destructive mt-0.5 size-3.5 shrink-0" />
                  {w}
                </li>
              ))}
            </ul>
          )}
          {impact && (
            <>
              <p className="text-muted-foreground text-xs">{t("deleteDialog.irreversible")}</p>
              <div className="space-y-2">
                <Label htmlFor="account-delete-confirm">
                  {t("deleteDialog.confirmLabel", { name: impact.name })}
                </Label>
                <Input
                  id="account-delete-confirm"
                  value={typed}
                  onChange={(e) => setTyped(e.target.value)}
                  autoComplete="off"
                  spellCheck={false}
                />
              </div>
            </>
          )}
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{t(`error.${error}`)}</AlertDescription>
            </Alert>
          )}
          <DialogFooter>
            <DialogClose render={<Button variant="ghost" type="button" disabled={pending} />}>
              {t("deleteDialog.keep")}
            </DialogClose>
            <Button variant="destructive" type="submit" disabled={!impact || !matches || pending}>
              {pending ? t("deleteDialog.deleting") : t("deleteDialog.confirm")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

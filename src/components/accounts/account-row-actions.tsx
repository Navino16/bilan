"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { Archive, ArchiveRestore, MoreVertical, Pencil, Share2, Trash2 } from "lucide-react";
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
import { AccountForm } from "@/components/accounts/account-form";
import { AccountDeleteDialog } from "@/components/accounts/account-delete-dialog";
import { ShareDialog, type ShareGroup } from "@/components/accounts/share-dialog";
import { archiveAccountAction, unarchiveAccountAction } from "@/server/transport/actions/accounts";

export type EditableAccount = {
  id: string;
  name: string;
  type: string;
  bankName: string | null;
  color: string | null;
  initialBalance: number;
  ibanMasked: string | null;
  archived: boolean;
};

type Dialogs = "edit" | "share" | "archive" | "delete" | null;

export function AccountRowActions({
  account,
  groups,
}: {
  account: EditableAccount;
  groups: ShareGroup[];
}) {
  const t = useTranslations("accounts");
  const router = useRouter();
  const [open, setOpen] = useState<Dialogs>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function setArchived(archived: boolean) {
    const fd = new FormData();
    fd.set("id", account.id);
    setError(null);
    startTransition(async () => {
      const result = await (archived ? archiveAccountAction : unarchiveAccountAction)(null, fd);
      if (!result?.ok) return setError(result?.error === "FORBIDDEN" ? "FORBIDDEN" : "FAILED");
      setOpen(null);
      router.refresh();
    });
  }

  function openDialog(dialog: Dialogs) {
    setError(null);
    setOpen(dialog);
  }

  const onOpenChange = (dialog: Exclude<Dialogs, null>) => (next: boolean) =>
    setOpen(next ? dialog : null);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t("actionsFor", { name: account.name })}
              disabled={pending}
            />
          }
        >
          <MoreVertical />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-44">
          {account.archived ? (
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
              <DropdownMenuItem onClick={() => openDialog("share")}>
                <Share2 />
                {t("share")}
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
      {!account.archived && (
        <>
          <AccountForm
            mode="edit"
            account={account}
            open={open === "edit"}
            onOpenChange={onOpenChange("edit")}
          />
          <ShareDialog
            accountId={account.id}
            accountName={account.name}
            groups={groups}
            open={open === "share"}
            onOpenChange={onOpenChange("share")}
          />
          <Dialog
            open={open === "archive"}
            onOpenChange={(next) => !pending && onOpenChange("archive")(next)}
          >
            <DialogContent data-slot="account-archive-dialog">
              <DialogHeader>
                <DialogTitle>{t("archiveTitle", { name: account.name })}</DialogTitle>
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
                  {t("archive")}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </>
      )}
      {open === "delete" && <AccountDeleteDialog account={account} onClose={() => setOpen(null)} />}
    </>
  );
}

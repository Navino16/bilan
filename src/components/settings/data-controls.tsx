"use client";

import { useActionState, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Download, TriangleAlert } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
  DialogClose,
} from "@/components/ui/dialog";
import { overline } from "@/components/transactions/bits";
import {
  deleteAccountAction,
  type AccountDataState,
} from "@/server/transport/actions/account-data";

export function DataControls({ locale }: { locale: string }) {
  const t = useTranslations("settings.data");
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState<AccountDataState, FormData>(
    deleteAccountAction,
    null,
  );

  useEffect(() => {
    if (state?.ok) window.location.assign(`/${locale}`);
  }, [state, locale]);

  return (
    <div className="mx-auto w-full max-w-2xl space-y-6">
      <div className="space-y-1">
        <div className={overline}>{t("overline")}</div>
        <h1 className="font-display text-4xl leading-none">{t("title")}</h1>
        <p className="text-muted-foreground text-sm">{t("subtitle")}</p>
      </div>

      {/* Export */}
      <Card className="gap-4 p-6">
        <div>
          <div className={overline}>{t("exportOverline")}</div>
          <div className="font-display text-xl">{t("exportTitle")}</div>
          <p className="text-muted-foreground mt-1 text-sm">{t("exportHint")}</p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <a
            href="/api/export/transactions"
            download
            className={buttonVariants({ variant: "outline" })}
          >
            <Download />
            {t("exportCsv")}
          </a>
          <a href="/api/export/data" download className={buttonVariants({ variant: "outline" })}>
            <Download />
            {t("exportJson")}
          </a>
        </div>
      </Card>

      {/* Danger zone */}
      <Card className="border-destructive/40 gap-4 p-6">
        <div>
          <div className={overline}>{t("dangerZone")}</div>
          <div className="font-display text-xl">{t("deleteTitle")}</div>
          <p className="text-muted-foreground mt-1 text-sm">{t("deleteWarning")}</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger
            render={
              <Button variant="destructive" className="w-full sm:w-auto">
                <TriangleAlert />
                {t("deleteTitle")}
              </Button>
            }
          />
          <DialogContent>
            <form action={action} className="space-y-4">
              <DialogHeader>
                <DialogTitle>{t("deleteTitle")}</DialogTitle>
                <DialogDescription>{t("deleteWarning")}</DialogDescription>
              </DialogHeader>
              <div className="space-y-2">
                <Label htmlFor="delete-password">{t("passwordLabel")}</Label>
                <Input
                  id="delete-password"
                  name="password"
                  type="password"
                  required
                  autoComplete="current-password"
                />
              </div>
              {state && !state.ok && (
                <Alert variant="destructive">
                  <AlertDescription>
                    {t(`error.${state.error}` as "error.INVALID")}
                  </AlertDescription>
                </Alert>
              )}
              <DialogFooter>
                <DialogClose render={<Button variant="ghost" type="button" />}>
                  {t("cancel")}
                </DialogClose>
                <Button variant="destructive" type="submit" disabled={pending}>
                  {pending ? t("deleting") : t("confirmDelete")}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </Card>
    </div>
  );
}

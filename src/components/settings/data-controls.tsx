"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
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
import { deleteAccountAction } from "@/server/transport/actions/account-data";
import { useActionForm } from "@/components/forms/use-action-form";
import { FieldError } from "@/components/forms/field-error";
import { PageHeader } from "@/components/shell/page-header";
import { SectionCard } from "@/components/shell/section-card";
import { DownloadButton } from "./download-button";

export function DataControls({
  locale,
  hasPassword,
  email,
}: {
  locale: string;
  hasPassword: boolean;
  email: string;
}) {
  const t = useTranslations("settings.data");
  const [open, setOpen] = useState(false);
  const [exportFailed, setExportFailed] = useState(false);
  const form = useActionForm(deleteAccountAction, {
    resetOnSuccess: false,
    onSuccess: () => window.location.assign(`/${locale}/login?deleted=1`),
  });

  return (
    <div className="space-y-6">
      <PageHeader overline={t("overline")} title={t("title")} subtitle={t("subtitle")} />

      {/* Export */}
      <SectionCard overline={t("exportOverline")} title={t("exportTitle")} hint={t("exportHint")}>
        <div className="flex flex-col gap-2 sm:flex-row">
          <DownloadButton
            href={`/api/export/transactions?locale=${locale}`}
            fallbackFilename="bilan-transactions.csv"
            pendingLabel={t("exporting")}
            onError={setExportFailed}
          >
            {t("exportCsv")}
          </DownloadButton>
          <DownloadButton
            href="/api/export/data"
            fallbackFilename="bilan-data-export.json"
            pendingLabel={t("exporting")}
            onError={setExportFailed}
          >
            {t("exportJson")}
          </DownloadButton>
        </div>
        {exportFailed && (
          <Alert variant="destructive">
            <AlertDescription>{t("exportFailed")}</AlertDescription>
          </Alert>
        )}
      </SectionCard>

      {/* Danger zone */}
      <SectionCard
        className="border-destructive/40"
        overline={t("dangerZone")}
        title={t("deleteTitle")}
        hint={t("deleteWarning")}
      >
        <Dialog
          open={open}
          onOpenChange={(next) => {
            setOpen(next);
            if (!next) form.reset();
          }}
        >
          <DialogTrigger
            render={
              <Button variant="destructive" className="w-full sm:w-auto sm:self-start">
                <TriangleAlert />
                {t("deleteTitle")}
              </Button>
            }
          />
          <DialogContent>
            <form {...form.formProps} className="space-y-4">
              <DialogHeader>
                <DialogTitle>{t("deleteTitle")}</DialogTitle>
                <DialogDescription>{t("deleteWarning")}</DialogDescription>
              </DialogHeader>
              {hasPassword ? (
                <div className="space-y-2">
                  <Label htmlFor="delete-password">{t("passwordLabel")}</Label>
                  <Input
                    id="delete-password"
                    name="password"
                    type="password"
                    required
                    autoComplete="current-password"
                    {...form.fieldProps("password")}
                  />
                  <FieldError form={form} name="password" />
                </div>
              ) : (
                <div className="space-y-2">
                  <Label htmlFor="delete-confirm-email">{t("confirmEmailLabel", { email })}</Label>
                  <Input
                    id="delete-confirm-email"
                    name="confirmEmail"
                    type="email"
                    required
                    autoComplete="off"
                    placeholder={email}
                    {...form.fieldProps("confirmEmail")}
                  />
                  <FieldError form={form} name="confirmEmail" />
                </div>
              )}
              {form.error && (
                <Alert variant="destructive">
                  <AlertDescription>{t(`error.${form.error}` as "error.INVALID")}</AlertDescription>
                </Alert>
              )}
              <DialogFooter>
                <DialogClose render={<Button variant="ghost" type="button" />}>
                  {t("cancel")}
                </DialogClose>
                <Button variant="destructive" type="submit" disabled={form.pending}>
                  {form.pending ? t("deleting") : t("confirmDelete")}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </SectionCard>
    </div>
  );
}

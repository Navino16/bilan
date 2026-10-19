"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { NativeSelect } from "@/components/ui/native-select";
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
import type { OwnDeletionImpact } from "@/server/services/users/own-deletion";
import { exportTransactionsHref } from "@/lib/transaction-filters";
import { DownloadButton } from "./download-button";

export type ExportAccountOption = { id: string; name: string; archived: boolean };

export function DataControls({
  locale,
  hasPassword,
  email,
  impact,
  accounts,
}: {
  locale: string;
  hasPassword: boolean;
  email: string;
  impact: OwnDeletionImpact | null;
  accounts: ExportAccountOption[];
}) {
  const t = useTranslations("settings.data");
  const [open, setOpen] = useState(false);
  const [exportFailed, setExportFailed] = useState(false);
  const [exportFilter, setExportFilter] = useState({ from: "", to: "", accountId: "" });
  const form = useActionForm(deleteAccountAction, {
    resetOnSuccess: false,
    onSuccess: () => window.location.assign(`/${locale}/login?deleted=1`),
  });
  const consequences = impact
    ? [
        ...(impact.accounts > 0
          ? [
              t("impact.accounts", {
                count: impact.accounts,
                transactions: impact.transactions,
                shared: impact.sharedAccounts,
              }),
            ]
          : []),
        t("impact.personal"),
        ...impact.transfers.map((tr) => t("impact.transfer", tr)),
        ...impact.deletedGroups.map((group) => t("impact.group", { group })),
        ...(impact.budgetLines > 0 ? [t("impact.budgetLines")] : []),
      ]
    : [];

  return (
    <div className="space-y-6">
      <PageHeader overline={t("overline")} title={t("title")} subtitle={t("subtitle")} />

      {/* Export */}
      <SectionCard overline={t("exportOverline")} title={t("exportTitle")} hint={t("exportHint")}>
        <fieldset data-slot="export-filters" className="space-y-3">
          <legend className="text-sm font-medium">{t("exportFilters")}</legend>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="export-from">{t("exportFrom")}</Label>
              <Input
                id="export-from"
                type="date"
                value={exportFilter.from}
                max={exportFilter.to || undefined}
                onChange={(e) => setExportFilter((f) => ({ ...f, from: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="export-to">{t("exportTo")}</Label>
              <Input
                id="export-to"
                type="date"
                value={exportFilter.to}
                min={exportFilter.from || undefined}
                onChange={(e) => setExportFilter((f) => ({ ...f, to: e.target.value }))}
              />
            </div>
            <div className="min-w-0 space-y-2">
              <Label htmlFor="export-account">{t("exportAccount")}</Label>
              <NativeSelect
                id="export-account"
                value={exportFilter.accountId}
                onChange={(e) => setExportFilter((f) => ({ ...f, accountId: e.target.value }))}
              >
                <option value="">{t("exportAllAccounts")}</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.archived ? t("exportArchivedAccount", { name: a.name }) : a.name}
                  </option>
                ))}
              </NativeSelect>
            </div>
          </div>
          <p className="text-muted-foreground text-xs">{t("exportFiltersHint")}</p>
        </fieldset>
        <div className="flex flex-col gap-2 sm:flex-row">
          <DownloadButton
            href={exportTransactionsHref(locale, exportFilter)}
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
              {consequences.length > 0 && (
                <div data-slot="delete-impact" className="space-y-1.5 text-sm">
                  <p className="font-medium">{t("impact.title")}</p>
                  <ul className="text-muted-foreground list-disc space-y-1 pl-5">
                    {consequences.map((line) => (
                      <li key={line}>{line}</li>
                    ))}
                  </ul>
                </div>
              )}
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
                  <AlertDescription>{t(`error.${form.error}` as "error.FAILED")}</AlertDescription>
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

"use client";

import { useTranslations } from "next-intl";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useActionForm } from "@/components/forms/use-action-form";
import { startBankAuthAction } from "@/server/transport/actions/bank-sync";

export function BankReconnectButton({
  connectionId,
  aspspName,
  country,
  variant = "outline",
}: {
  connectionId: string;
  aspspName: string;
  country: string;
  variant?: "default" | "outline";
}) {
  const t = useTranslations("accounts.bankSync.reconnect");
  const tError = useTranslations("accounts.bankSync.error");
  const form = useActionForm(startBankAuthAction);
  const error = form.error;
  return (
    <form {...form.formProps} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="reconnectOf" value={connectionId} />
      <input type="hidden" name="aspspName" value={aspspName} />
      <input type="hidden" name="country" value={country} />
      <Button type="submit" variant={variant} size="sm" disabled={form.pending}>
        <RefreshCw className={form.pending ? "animate-spin" : undefined} />
        {form.pending ? t("submitting") : t("submit")}
      </Button>
      {error && (
        <span role="alert" className="text-destructive text-xs">
          {tError.has(error) ? tError(error as "FAILED") : tError("FAILED")}
        </span>
      )}
    </form>
  );
}

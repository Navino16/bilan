"use client";

import { useLocale, useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { resetRequestAction } from "@/server/transport/actions/auth";
import { useActionForm } from "@/components/forms/use-action-form";
import { FieldError } from "@/components/forms/field-error";

export function ResetRequestForm() {
  const t = useTranslations("auth.reset");
  const locale = useLocale();
  const form = useActionForm(resetRequestAction);
  const { state, pending } = form;

  if (state?.ok) {
    return (
      <Alert>
        <AlertDescription>{t("sent")}</AlertDescription>
      </Alert>
    );
  }

  return (
    <form {...form.formProps} className="space-y-4">
      <input type="hidden" name="locale" value={locale} />
      <div className="space-y-2">
        <Label htmlFor="email">{t("email")}</Label>
        <Input
          id="email"
          name="email"
          type="email"
          required
          autoComplete="email"
          {...form.fieldProps("email")}
        />
        <FieldError form={form} name="email" />
      </div>
      {state && !state.ok && (
        <Alert variant="destructive">
          <AlertDescription>
            {state.error === "RATE_LIMITED" ? t("error.rateLimited") : t("error.invalid")}
          </AlertDescription>
        </Alert>
      )}
      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? t("submitting") : t("submit")}
      </Button>
    </form>
  );
}

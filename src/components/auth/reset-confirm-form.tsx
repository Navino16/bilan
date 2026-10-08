"use client";

import { useEffect } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "./password-input";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { resetConfirmAction } from "@/server/transport/actions/auth";
import { useActionForm } from "@/components/forms/use-action-form";
import { FieldError } from "@/components/forms/field-error";

export function ResetConfirmForm({ token, locale }: { token: string; locale: string }) {
  const t = useTranslations("auth.resetConfirm");
  const router = useRouter();
  const form = useActionForm(resetConfirmAction, { resetOnSuccess: false });
  const { state, pending } = form;

  useEffect(() => {
    if (state?.ok) router.push(`/${locale}/login?reset=1`);
  }, [state, router, locale]);

  return (
    <form {...form.formProps} className="space-y-4">
      <input type="hidden" name="token" value={token} />
      <div className="space-y-2">
        <Label htmlFor="password">{t("password")}</Label>
        <PasswordInput
          id="password"
          name="password"
          required
          minLength={12}
          autoComplete="new-password"
          {...form.fieldProps("password", "password-hint")}
        />
        <FieldError form={form} name="password" />
        <p id="password-hint" className="text-muted-foreground text-xs">
          {t("passwordHint")}
        </p>
      </div>
      {state && !state.ok && (
        <Alert variant="destructive">
          <AlertDescription>
            {state.error === "INVALID_TOKEN" ? t("error.invalidToken") : t("error.invalid")}
          </AlertDescription>
        </Alert>
      )}
      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? t("submitting") : t("submit")}
      </Button>
    </form>
  );
}

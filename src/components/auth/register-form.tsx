"use client";

import { useEffect } from "react";
import { useTranslations } from "next-intl";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "./password-input";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { registerAction } from "@/server/transport/actions/auth";
import { NAME_MAX } from "@/lib/validation/name";
import { useActionForm } from "@/components/forms/use-action-form";
import { FieldError } from "@/components/forms/field-error";

export function RegisterForm({ locale, mode }: { locale: string; mode: string }) {
  const t = useTranslations("auth.register");
  const router = useRouter();
  const params = useSearchParams();
  const form = useActionForm(registerAction, { resetOnSuccess: false });
  const { state, pending, error } = form;

  useEffect(() => {
    if (state?.ok) router.push(`/${locale}/dashboard`);
  }, [state, router, locale]);

  if (mode === "DISABLED") {
    return (
      <Alert>
        <AlertDescription>{t("closed")}</AlertDescription>
      </Alert>
    );
  }

  const inviteOnly = mode === "INVITE_ONLY";

  return (
    <form {...form.formProps} className="space-y-4">
      <input type="hidden" name="invitationToken" value={params.get("invitation") ?? ""} />
      {inviteOnly ? (
        <div className="space-y-2">
          <Label htmlFor="adminToken">{t("token")}</Label>
          <Input
            id="adminToken"
            name="adminToken"
            required
            defaultValue={params.get("adminToken") ?? ""}
            {...form.fieldProps("adminToken", "adminToken-hint")}
          />
          <FieldError form={form} name="adminToken" />
          <p id="adminToken-hint" className="text-muted-foreground text-xs">
            {t("tokenHint")}
          </p>
        </div>
      ) : (
        <input type="hidden" name="adminToken" value={params.get("adminToken") ?? ""} />
      )}
      <div className="space-y-2">
        <Label htmlFor="name">{t("name")}</Label>
        <Input
          id="name"
          name="name"
          required
          maxLength={NAME_MAX}
          autoComplete="name"
          {...form.fieldProps("name")}
        />
        <FieldError form={form} name="name" />
      </div>
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
      <div className="space-y-2">
        <Label htmlFor="confirmPassword">{t("confirmPassword")}</Label>
        <PasswordInput
          id="confirmPassword"
          name="confirmPassword"
          required
          minLength={12}
          autoComplete="new-password"
          {...form.fieldProps("confirmPassword")}
        />
        <FieldError form={form} name="confirmPassword" />
      </div>
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{t(`error.${error}`)}</AlertDescription>
        </Alert>
      )}
      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? t("submitting") : t("submit")}
      </Button>
    </form>
  );
}

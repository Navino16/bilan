"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { createSignupTokenAction } from "@/server/transport/actions/admin";
import {
  SIGNUP_TOKEN_DEFAULT_EXPIRY_DAYS,
  SIGNUP_TOKEN_EXPIRY_DAYS,
  SIGNUP_TOKEN_MAX_USES,
  SIGNUP_TOKEN_DESCRIPTION_MAX,
} from "@/lib/validation/signup-token";
import { useActionForm } from "@/components/forms/use-action-form";
import { FieldError } from "@/components/forms/field-error";

export function SignupTokenCreateForm() {
  const t = useTranslations("admin.signupTokens");
  const router = useRouter();
  const form = useActionForm(createSignupTokenAction, { onSuccess: () => router.refresh() });
  const { pending } = form;

  return (
    <form {...form.formProps} className="flex flex-wrap items-end gap-4">
      <div className="min-w-48 flex-1 space-y-2">
        <Label htmlFor="st-desc">{t("description")}</Label>
        <Input
          id="st-desc"
          name="description"
          maxLength={SIGNUP_TOKEN_DESCRIPTION_MAX}
          placeholder={t("descriptionPlaceholder")}
          {...form.fieldProps("description")}
        />
        <FieldError form={form} name="description" />
      </div>
      <div className="space-y-2">
        <Label htmlFor="st-max">{t("maxUses")}</Label>
        <Input
          id="st-max"
          name="maxUses"
          type="number"
          min={1}
          max={SIGNUP_TOKEN_MAX_USES}
          placeholder="∞"
          className="w-28"
          {...form.fieldProps("maxUses")}
        />
        <FieldError form={form} name="maxUses" />
      </div>
      <div className="space-y-2">
        <Label htmlFor="st-expiry">{t("expiresIn")}</Label>
        <NativeSelect
          id="st-expiry"
          name="expiresInDays"
          defaultValue={String(SIGNUP_TOKEN_DEFAULT_EXPIRY_DAYS)}
          className="w-36"
        >
          {SIGNUP_TOKEN_EXPIRY_DAYS.map((d) => (
            <option key={d} value={d}>
              {t("expiresInDays", { count: d })}
            </option>
          ))}
          <option value="">{t("never")}</option>
        </NativeSelect>
      </div>
      <Button type="submit" disabled={pending}>
        {pending ? t("creating") : t("create")}
      </Button>
      {form.error && (
        <Alert variant="destructive" className="w-full">
          <AlertDescription>{t(`error.${form.error}`)}</AlertDescription>
        </Alert>
      )}
    </form>
  );
}

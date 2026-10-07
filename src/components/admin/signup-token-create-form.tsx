"use client";

import { useActionState, useEffect, useRef } from "react";
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
} from "@/lib/validation/signup-token";

export function SignupTokenCreateForm() {
  const t = useTranslations("admin.signupTokens");
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [state, action, pending] = useActionState(createSignupTokenAction, null);

  useEffect(() => {
    if (state?.ok) {
      formRef.current?.reset();
      router.refresh();
    }
  }, [state, router]);

  return (
    <form ref={formRef} action={action} className="flex flex-wrap items-end gap-4">
      <div className="min-w-48 flex-1 space-y-2">
        <Label htmlFor="st-desc">{t("description")}</Label>
        <Input
          id="st-desc"
          name="description"
          maxLength={191}
          placeholder={t("descriptionPlaceholder")}
        />
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
        />
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
      {state && !state.ok && (
        <Alert variant="destructive" className="w-full">
          <AlertDescription>{t(`error.${state.error}`)}</AlertDescription>
        </Alert>
      )}
    </form>
  );
}

"use client";

import { useActionState, useEffect, useRef } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { adminCreateUserAction } from "@/server/transport/actions/admin";
import { NativeSelect } from "@/components/ui/native-select";

export function CreateUserForm() {
  const t = useTranslations("admin.users");
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [state, action, pending] = useActionState(adminCreateUserAction, null);

  useEffect(() => {
    if (state?.ok) {
      formRef.current?.reset();
      router.refresh();
    }
  }, [state, router]);

  return (
    <form ref={formRef} action={action} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="cu-name">{t("name")}</Label>
          <Input id="cu-name" name="name" required />
        </div>
        <div className="space-y-2">
          <Label htmlFor="cu-email">{t("email")}</Label>
          <Input id="cu-email" name="email" type="email" required />
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor="cu-role">{t("role")}</Label>
        <NativeSelect id="cu-role" name="role" defaultValue="USER">
          <option value="USER">{t("roleUser")}</option>
          <option value="ADMIN">{t("roleAdmin")}</option>
        </NativeSelect>
      </div>
      {state?.ok && (
        <Alert>
          <AlertDescription>{t("created")}</AlertDescription>
        </Alert>
      )}
      {state && !state.ok && (
        <Alert variant="destructive">
          <AlertDescription>{t(`error.${state.error}`)}</AlertDescription>
        </Alert>
      )}
      <Button type="submit" disabled={pending}>
        {pending ? t("creating") : t("create")}
      </Button>
    </form>
  );
}

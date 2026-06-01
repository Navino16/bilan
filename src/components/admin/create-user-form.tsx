"use client";

import { useActionState, useEffect, useRef } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { adminCreateUserAction } from "@/server/transport/actions/admin";

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
        <select
          id="cu-role"
          name="role"
          defaultValue="USER"
          className="border-input bg-background h-9 w-full rounded-md border px-3 text-sm"
        >
          <option value="USER">{t("roleUser")}</option>
          <option value="ADMIN">{t("roleAdmin")}</option>
        </select>
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

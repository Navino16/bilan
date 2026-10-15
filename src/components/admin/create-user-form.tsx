"use client";

import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { adminCreateUserAction } from "@/server/transport/actions/admin";
import { NativeSelect } from "@/components/ui/native-select";
import { NAME_MAX } from "@/lib/validation/name";
import { useActionForm } from "@/components/forms/use-action-form";
import { FieldError } from "@/components/forms/field-error";
import type { CreatableRole } from "@/lib/instance-roles";

export function CreateUserForm({ roles }: { roles: CreatableRole[] }) {
  const t = useTranslations("admin.users");
  const tRoles = useTranslations("admin.roles");
  const locale = useLocale();
  const router = useRouter();
  const form = useActionForm(adminCreateUserAction, { onSuccess: () => router.refresh() });
  const { state, pending } = form;

  return (
    <form {...form.formProps} className="space-y-4">
      <input type="hidden" name="locale" value={locale} />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <div className="space-y-2">
          <Label htmlFor="cu-name">{t("name")}</Label>
          <Input
            id="cu-name"
            name="name"
            required
            maxLength={NAME_MAX}
            {...form.fieldProps("name")}
          />
          <FieldError form={form} name="name" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="cu-email">{t("email")}</Label>
          <Input id="cu-email" name="email" type="email" required {...form.fieldProps("email")} />
          <FieldError form={form} name="email" />
        </div>
        {roles.length > 1 ? (
          <div className="space-y-2">
            <Label htmlFor="cu-role">{t("role")}</Label>
            <NativeSelect id="cu-role" name="role" defaultValue="USER">
              {roles.map((r) => (
                <option key={r} value={r}>
                  {tRoles(r)}
                </option>
              ))}
            </NativeSelect>
          </div>
        ) : (
          <input type="hidden" name="role" value="USER" />
        )}
      </div>
      {state?.ok && (
        <Alert>
          <AlertDescription>{t("created")}</AlertDescription>
        </Alert>
      )}
      {form.error && (
        <Alert variant="destructive">
          <AlertDescription>{t(`error.${form.error}`)}</AlertDescription>
        </Alert>
      )}
      <Button type="submit" disabled={pending}>
        {pending ? t("creating") : t("create")}
      </Button>
    </form>
  );
}

"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { INVITABLE_GROUP_ROLES } from "@/lib/validation/group";
import { createInvitationAction } from "@/server/transport/actions/invitations";
import { NativeSelect } from "@/components/ui/native-select";
import { useActionForm } from "@/components/forms/use-action-form";
import { FieldError } from "@/components/forms/field-error";

export function InviteForm({ groupId }: { groupId: string }) {
  const t = useTranslations("invitations");
  const tg = useTranslations("groups");
  const router = useRouter();
  const form = useActionForm(createInvitationAction, { onSuccess: () => router.refresh() });

  return (
    <form {...form.formProps} className="space-y-3">
      <input type="hidden" name="groupId" value={groupId} />
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="flex-1 space-y-2">
          <Label htmlFor="inv-email">{t("email")}</Label>
          <Input
            id="inv-email"
            name="email"
            type="email"
            required
            placeholder={t("emailPlaceholder")}
            {...form.fieldProps("email")}
          />
          <FieldError form={form} name="email" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="inv-role">{t("role")}</Label>
          <NativeSelect id="inv-role" name="role" defaultValue="MEMBER" className="sm:w-32">
            {INVITABLE_GROUP_ROLES.map((r) => (
              <option key={r} value={r}>
                {tg(`roles.${r}`)}
              </option>
            ))}
          </NativeSelect>
        </div>
        <Button type="submit" disabled={form.pending}>
          <Send />
          {form.pending ? t("sending") : t("send")}
        </Button>
      </div>
      {form.error && (
        <Alert variant="destructive">
          <AlertDescription>{t(`error.${form.error}`)}</AlertDescription>
        </Alert>
      )}
    </form>
  );
}

"use client";

import { useActionState, useEffect, useRef } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { INVITABLE_GROUP_ROLES } from "@/lib/validation/group";
import {
  createInvitationAction,
  type InvitationActionState,
} from "@/server/transport/actions/invitations";
import { NativeSelect } from "@/components/ui/native-select";

export function InviteForm({ groupId }: { groupId: string }) {
  const t = useTranslations("invitations");
  const tg = useTranslations("groups");
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const initial: InvitationActionState = null;
  const [state, action, pending] = useActionState(createInvitationAction, initial);

  useEffect(() => {
    if (state?.ok) {
      formRef.current?.reset();
      router.refresh();
    }
  }, [state, router]);

  return (
    <form ref={formRef} action={action} className="space-y-3">
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
          />
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
        <Button type="submit" disabled={pending}>
          <Send />
          {pending ? t("sending") : t("send")}
        </Button>
      </div>
      {state && !state.ok && (
        <Alert variant="destructive">
          <AlertDescription>{t(`error.${state.error}`)}</AlertDescription>
        </Alert>
      )}
    </form>
  );
}

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
    <form ref={formRef} action={action} className="flex flex-col gap-3 sm:flex-row sm:items-end">
      <input type="hidden" name="groupId" value={groupId} />
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
        <select
          id="inv-role"
          name="role"
          defaultValue="MEMBER"
          className="border-input bg-background h-8 w-full rounded-lg border px-2.5 text-sm sm:w-32"
        >
          {INVITABLE_GROUP_ROLES.map((r) => (
            <option key={r} value={r}>
              {tg(`roles.${r}`)}
            </option>
          ))}
        </select>
      </div>
      <Button type="submit" disabled={pending}>
        <Send />
        {pending ? t("sending") : t("send")}
      </Button>
      {state && !state.ok && (
        <Alert variant="destructive" className="sm:hidden">
          <AlertDescription>{t(`error.${state.error}`)}</AlertDescription>
        </Alert>
      )}
    </form>
  );
}

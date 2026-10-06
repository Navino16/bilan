"use client";

import { useActionState, useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { changePasswordAction } from "@/server/transport/actions/auth";

function PasswordForm({
  minLength,
  onDone,
  onCancel,
}: {
  minLength: number;
  onDone: () => void;
  onCancel: () => void;
}) {
  const t = useTranslations("settings.security.passwordCard");
  // Controlled so a failed submit doesn't wipe the fields (React resets uncontrolled ones).
  const [fields, setFields] = useState({
    currentPassword: "",
    newPassword: "",
    confirmPassword: "",
  });
  const [revoke, setRevoke] = useState(true);
  const bind = (name: keyof typeof fields) => ({
    name,
    value: fields[name],
    onChange: (e: React.ChangeEvent<HTMLInputElement>) =>
      setFields((f) => ({ ...f, [name]: e.target.value })),
  });
  const [state, action, pending] = useActionState(
    async (prev: Awaited<ReturnType<typeof changePasswordAction>>, formData: FormData) => {
      const res = await changePasswordAction(prev, formData);
      if (res?.ok) onDone();
      return res;
    },
    null,
  );

  return (
    <form action={action} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="pw-current">{t("current")}</Label>
        <Input
          id="pw-current"
          {...bind("currentPassword")}
          type="password"
          required
          autoComplete="current-password"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="pw-new">{t("new")}</Label>
        <Input
          id="pw-new"
          {...bind("newPassword")}
          type="password"
          required
          minLength={minLength}
          autoComplete="new-password"
        />
        <p className="text-muted-foreground text-xs">{t("minLength", { count: minLength })}</p>
      </div>
      <div className="space-y-2">
        <Label htmlFor="pw-confirm">{t("confirm")}</Label>
        <Input
          id="pw-confirm"
          {...bind("confirmPassword")}
          type="password"
          required
          minLength={minLength}
          autoComplete="new-password"
        />
      </div>
      <div className="flex items-center gap-3">
        <Switch id="pw-revoke" checked={revoke} onCheckedChange={setRevoke} />
        <Label htmlFor="pw-revoke">{t("revokeOthers")}</Label>
        <input type="hidden" name="revokeOtherSessions" value={String(revoke)} />
      </div>
      {state && !state.ok && (
        <Alert variant="destructive">
          <AlertDescription>{t(`error.${state.error}`)}</AlertDescription>
        </Alert>
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? t("working") : t("submit")}
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel} disabled={pending}>
          {t("cancel")}
        </Button>
      </div>
    </form>
  );
}

export function PasswordControls({ minLength }: { minLength: number }) {
  const t = useTranslations("settings.security.passwordCard");
  const [open, setOpen] = useState(false);
  const [changed, setChanged] = useState(false);

  if (open) {
    return (
      <div data-slot="password-controls">
        <PasswordForm
          minLength={minLength}
          onDone={() => {
            setChanged(true);
            setOpen(false);
          }}
          onCancel={() => setOpen(false)}
        />
      </div>
    );
  }

  return (
    <div className="space-y-4" data-slot="password-controls">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm tracking-[0.2em]" aria-hidden>
          ••••••••••
        </span>
        <Button
          variant="outline"
          onClick={() => {
            setChanged(false);
            setOpen(true);
          }}
        >
          {t("edit")}
        </Button>
      </div>
      {changed && (
        <Alert>
          <AlertDescription>{t("changed")}</AlertDescription>
        </Alert>
      )}
    </div>
  );
}

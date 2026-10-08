"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { changePasswordAction } from "@/server/transport/actions/auth";
import { useActionForm } from "@/components/forms/use-action-form";
import { FieldError } from "@/components/forms/field-error";

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
  const [revoke, setRevoke] = useState(true);
  const form = useActionForm(changePasswordAction, { onSuccess: onDone });
  const { pending } = form;

  return (
    <form {...form.formProps} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="pw-current">{t("current")}</Label>
        <Input
          id="pw-current"
          name="currentPassword"
          type="password"
          required
          autoComplete="current-password"
          {...form.fieldProps("currentPassword")}
        />
        <FieldError form={form} name="currentPassword" />
      </div>
      <div className="space-y-2">
        <Label htmlFor="pw-new">{t("new")}</Label>
        <Input
          id="pw-new"
          name="newPassword"
          type="password"
          required
          minLength={minLength}
          autoComplete="new-password"
          {...form.fieldProps("newPassword", "pw-new-hint")}
        />
        <FieldError form={form} name="newPassword" />
        <p id="pw-new-hint" className="text-muted-foreground text-xs">
          {t("minLength", { count: minLength })}
        </p>
      </div>
      <div className="space-y-2">
        <Label htmlFor="pw-confirm">{t("confirm")}</Label>
        <Input
          id="pw-confirm"
          name="confirmPassword"
          type="password"
          required
          minLength={minLength}
          autoComplete="new-password"
          {...form.fieldProps("confirmPassword")}
        />
        <FieldError form={form} name="confirmPassword" />
      </div>
      <div className="flex items-center gap-3">
        <Switch id="pw-revoke" checked={revoke} onCheckedChange={setRevoke} />
        <Label htmlFor="pw-revoke">{t("revokeOthers")}</Label>
        <input type="hidden" name="revokeOtherSessions" value={String(revoke)} />
      </div>
      {form.error && (
        <Alert variant="destructive">
          <AlertDescription>{t(`error.${form.error}`)}</AlertDescription>
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

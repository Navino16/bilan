"use client";

import { useActionState, useEffect, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { SectionCard } from "@/components/shell/section-card";
import { setAppSettingAction, type SettingsActionState } from "@/server/transport/actions/settings";

const selectClass = "border-input bg-background h-9 w-full rounded-md border px-3 text-sm";

function SettingForm({
  settingKey,
  label,
  children,
}: {
  settingKey: string;
  label: string;
  children: (id: string) => ReactNode;
}) {
  const t = useTranslations("admin.settings");
  const router = useRouter();
  const [state, action, pending] = useActionState<SettingsActionState, FormData>(
    setAppSettingAction,
    null,
  );
  useEffect(() => {
    if (state?.ok) router.refresh();
  }, [state, router]);
  const id = `set-${settingKey}`;

  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="key" value={settingKey} />
      <Label htmlFor={id}>{label}</Label>
      <div className="flex items-center gap-3">
        <div className="flex-1">{children(id)}</div>
        <Button type="submit" disabled={pending}>
          {pending ? t("saving") : t("save")}
        </Button>
      </div>
      {state?.ok && <p className="text-muted-foreground text-xs">{t("saved")}</p>}
      {state && !state.ok && (
        <Alert variant="destructive">
          <AlertDescription>{t(`error.${state.error}`)}</AlertDescription>
        </Alert>
      )}
    </form>
  );
}

export function AppSettingsForm({
  appName,
  registrationMode,
  credentialsEnabled,
  minPasswordLength,
  admin2faRequired,
}: {
  appName: string;
  registrationMode: string;
  credentialsEnabled: boolean;
  minPasswordLength: number;
  admin2faRequired: boolean;
}) {
  const t = useTranslations("admin.settings");
  return (
    <div className="space-y-6">
      <SectionCard
        overline={t("general.overline")}
        title={t("general.title")}
        hint={t("general.hint")}
      >
        <SettingForm settingKey="app_name" label={t("appName")}>
          {(id) => <Input id={id} name="value" defaultValue={appName} />}
        </SettingForm>
      </SectionCard>

      <SectionCard
        overline={t("access.overline")}
        title={t("access.title")}
        hint={t("access.hint")}
      >
        <SettingForm settingKey="registration_mode" label={t("registrationMode")}>
          {(id) => (
            <select id={id} name="value" defaultValue={registrationMode} className={selectClass}>
              <option value="OPEN">{t("mode.OPEN")}</option>
              <option value="INVITE_ONLY">{t("mode.INVITE_ONLY")}</option>
              <option value="DISABLED">{t("mode.DISABLED")}</option>
            </select>
          )}
        </SettingForm>

        <SettingForm settingKey="credentials_enabled" label={t("credentialsEnabled")}>
          {(id) => (
            <select
              id={id}
              name="value"
              defaultValue={String(credentialsEnabled)}
              className={selectClass}
            >
              <option value="true">{t("enabled")}</option>
              <option value="false">{t("disabled")}</option>
            </select>
          )}
        </SettingForm>
      </SectionCard>

      <SectionCard
        overline={t("security.overline")}
        title={t("security.title")}
        hint={t("security.hint")}
      >
        <SettingForm settingKey="min_password_length" label={t("minPasswordLength")}>
          {(id) => (
            <Input
              id={id}
              name="value"
              type="number"
              min={8}
              max={128}
              defaultValue={minPasswordLength}
            />
          )}
        </SettingForm>

        <SettingForm settingKey="security.admin_2fa_required" label={t("admin2faRequired")}>
          {(id) => (
            <select
              id={id}
              name="value"
              defaultValue={String(admin2faRequired)}
              className={selectClass}
            >
              <option value="true">{t("enabled")}</option>
              <option value="false">{t("disabled")}</option>
            </select>
          )}
        </SettingForm>
      </SectionCard>
    </div>
  );
}

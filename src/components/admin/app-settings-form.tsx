"use client";

import { createContext, use, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { SectionCard } from "@/components/shell/section-card";
import { setAppSettingsAction } from "@/server/transport/actions/settings";
import { NativeSelect } from "@/components/ui/native-select";
import { useActionForm, type ActionForm } from "@/components/forms/use-action-form";
import { FieldError } from "@/components/forms/field-error";
import { MIN_PASSWORD_LENGTH_RANGE } from "@/lib/validation/app-settings";

const CardForm = createContext<ActionForm | null>(null);

function SettingsCard({
  section,
  children,
}: {
  section: "general" | "access" | "security";
  children: ReactNode;
}) {
  const t = useTranslations("admin.settings");
  const router = useRouter();
  const form = useActionForm(setAppSettingsAction, {
    resetOnSuccess: false,
    summarizeFieldErrors: false,
    onSuccess: () => router.refresh(),
  });
  const { state, pending } = form;

  return (
    <SectionCard
      overline={t(`${section}.overline`)}
      title={t(`${section}.title`)}
      hint={t(`${section}.hint`)}
    >
      <form {...form.formProps} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <CardForm value={form}>{children}</CardForm>
        </div>
        <div className="flex items-center gap-3">
          <Button type="submit" disabled={pending}>
            {pending ? t("saving") : t("save")}
          </Button>
          {state?.ok && <p className="text-muted-foreground text-xs">{t("saved")}</p>}
        </div>
        {form.error && (
          <Alert variant="destructive">
            <AlertDescription>{t(`error.${form.error}`)}</AlertDescription>
          </Alert>
        )}
      </form>
    </SectionCard>
  );
}

function Field({
  settingKey,
  label,
  errorValues,
  children,
}: {
  settingKey: string;
  label: string;
  errorValues?: Record<string, number>;
  children: (
    props: { id: string; name: string } & Partial<ReturnType<ActionForm["fieldProps"]>>,
  ) => ReactNode;
}) {
  const form = use(CardForm);
  const id = `set-${settingKey}`;
  const name = `s:${settingKey}`;
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      {children({ id, name, ...form?.fieldProps(name) })}
      {form && <FieldError form={form} name={name} values={errorValues} />}
    </div>
  );
}

export function AppSettingsForm({
  appName,
  registrationMode,
  credentialsEnabled,
  minPasswordLength,
  admin2faRequired,
  canEditSecurity,
}: {
  appName: string;
  registrationMode: string;
  credentialsEnabled: boolean;
  minPasswordLength: number;
  admin2faRequired: boolean;
  canEditSecurity: boolean;
}) {
  const t = useTranslations("admin.settings");
  return (
    <div className="space-y-6">
      <SettingsCard section="general">
        <Field settingKey="app_name" label={t("appName")}>
          {(p) => <Input {...p} key={appName} defaultValue={appName} />}
        </Field>
      </SettingsCard>

      {canEditSecurity && (
        <SecurityCards
          registrationMode={registrationMode}
          credentialsEnabled={credentialsEnabled}
          minPasswordLength={minPasswordLength}
          admin2faRequired={admin2faRequired}
        />
      )}
    </div>
  );
}

function SecurityCards({
  registrationMode,
  credentialsEnabled,
  minPasswordLength,
  admin2faRequired,
}: {
  registrationMode: string;
  credentialsEnabled: boolean;
  minPasswordLength: number;
  admin2faRequired: boolean;
}) {
  const t = useTranslations("admin.settings");
  return (
    <>
      <SettingsCard section="access">
        <Field settingKey="registration_mode" label={t("registrationMode")}>
          {(p) => (
            <NativeSelect {...p} defaultValue={registrationMode}>
              <option value="OPEN">{t("mode.OPEN")}</option>
              <option value="INVITE_ONLY">{t("mode.INVITE_ONLY")}</option>
              <option value="DISABLED">{t("mode.DISABLED")}</option>
            </NativeSelect>
          )}
        </Field>
        <Field settingKey="credentials_enabled" label={t("credentialsEnabled")}>
          {(p) => (
            <NativeSelect {...p} defaultValue={String(credentialsEnabled)}>
              <option value="true">{t("enabled")}</option>
              <option value="false">{t("disabled")}</option>
            </NativeSelect>
          )}
        </Field>
      </SettingsCard>

      <SettingsCard section="security">
        <Field
          settingKey="min_password_length"
          label={t("minPasswordLength")}
          errorValues={MIN_PASSWORD_LENGTH_RANGE}
        >
          {(p) => (
            <Input
              {...p}
              key={minPasswordLength}
              type="number"
              min={MIN_PASSWORD_LENGTH_RANGE.min}
              max={MIN_PASSWORD_LENGTH_RANGE.max}
              defaultValue={minPasswordLength}
            />
          )}
        </Field>
        <Field settingKey="security.admin_2fa_required" label={t("admin2faRequired")}>
          {(p) => (
            <NativeSelect {...p} defaultValue={String(admin2faRequired)}>
              <option value="true">{t("enabled")}</option>
              <option value="false">{t("disabled")}</option>
            </NativeSelect>
          )}
        </Field>
      </SettingsCard>
    </>
  );
}

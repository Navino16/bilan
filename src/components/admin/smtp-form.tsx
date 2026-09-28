"use client";

import { useActionState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { upsertSmtpAction, type SettingsActionState } from "@/server/transport/actions/settings";
import { NativeSelect } from "@/components/ui/native-select";

export type SmtpDefaults = {
  host: string;
  port: number;
  secure: boolean;
  username: string;
  fromAddress: string;
  fromName: string | null;
  enabled: boolean;
} | null;

export function SmtpForm({ defaults }: { defaults: SmtpDefaults }) {
  const t = useTranslations("admin.smtp");
  const router = useRouter();
  const [state, action, pending] = useActionState<SettingsActionState, FormData>(
    upsertSmtpAction,
    null,
  );
  useEffect(() => {
    if (state?.ok) router.refresh();
  }, [state, router]);

  return (
    <form action={action} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="smtp-host">{t("host")}</Label>
          <Input id="smtp-host" name="host" defaultValue={defaults?.host ?? ""} required />
        </div>
        <div className="space-y-2">
          <Label htmlFor="smtp-port">{t("port")}</Label>
          <Input
            id="smtp-port"
            name="port"
            type="number"
            defaultValue={defaults?.port ?? 587}
            required
          />
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="smtp-username">{t("username")}</Label>
          <Input
            id="smtp-username"
            name="username"
            defaultValue={defaults?.username ?? ""}
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="smtp-password">{t("password")}</Label>
          <Input
            id="smtp-password"
            name="password"
            type="password"
            placeholder={defaults ? t("passwordKept") : ""}
            required={!defaults}
          />
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="smtp-from">{t("fromAddress")}</Label>
          <Input
            id="smtp-from"
            name="fromAddress"
            type="email"
            defaultValue={defaults?.fromAddress ?? ""}
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="smtp-fromName">{t("fromName")}</Label>
          <Input id="smtp-fromName" name="fromName" defaultValue={defaults?.fromName ?? ""} />
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="smtp-secure">{t("secure")}</Label>
          <NativeSelect
            id="smtp-secure"
            name="secure"
            defaultValue={String(defaults?.secure ?? true)}
          >
            <option value="true">{t("secureTls")}</option>
            <option value="false">{t("securePlain")}</option>
          </NativeSelect>
        </div>
        <div className="space-y-2">
          <Label htmlFor="smtp-enabled">{t("enabled")}</Label>
          <NativeSelect
            id="smtp-enabled"
            name="enabled"
            defaultValue={String(defaults?.enabled ?? true)}
          >
            <option value="true">{t("on")}</option>
            <option value="false">{t("off")}</option>
          </NativeSelect>
        </div>
      </div>
      {state?.ok && (
        <Alert>
          <AlertDescription>{t("saved")}</AlertDescription>
        </Alert>
      )}
      {state && !state.ok && (
        <Alert variant="destructive">
          <AlertDescription>{t(`error.${state.error}`)}</AlertDescription>
        </Alert>
      )}
      <Button type="submit" disabled={pending}>
        {pending ? t("saving") : t("save")}
      </Button>
    </form>
  );
}

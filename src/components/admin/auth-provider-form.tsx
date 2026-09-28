"use client";

import { useActionState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  upsertAuthProviderAction,
  type SettingsActionState,
} from "@/server/transport/actions/settings";
import { NativeSelect } from "@/components/ui/native-select";

export type AuthProviderDefaults = {
  key: string;
  type: string;
  displayName: string;
  enabled: boolean;
  issuer: string | null;
  clientId: string | null;
  scopes: string | null;
  config: {
    pkce?: boolean;
    authorizationUrl?: string;
    tokenUrl?: string;
    userInfoUrl?: string;
    mapName?: string;
    mapEmail?: string;
  } | null;
};

export function AuthProviderForm({ provider }: { provider?: AuthProviderDefaults }) {
  const t = useTranslations("admin.authProviders");
  const router = useRouter();
  const [state, action, pending] = useActionState<SettingsActionState, FormData>(
    upsertAuthProviderAction,
    null,
  );
  useEffect(() => {
    if (state?.ok) router.refresh();
  }, [state, router]);

  const isEdit = Boolean(provider);
  const cfg = provider?.config ?? {};
  const prefix = provider ? `ap-${provider.key}` : "ap-new";

  return (
    <form action={action} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor={`${prefix}-key`}>{t("key")}</Label>
          <Input
            id={`${prefix}-key`}
            name="key"
            defaultValue={provider?.key ?? ""}
            readOnly={isEdit}
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor={`${prefix}-type`}>{t("type")}</Label>
          <NativeSelect id={`${prefix}-type`} name="type" defaultValue={provider?.type ?? "oidc"}>
            <option value="credentials">{t("typeCredentials")}</option>
            <option value="oidc">{t("typeOidc")}</option>
            <option value="google">{t("typeGoogle")}</option>
          </NativeSelect>
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor={`${prefix}-displayName`}>{t("displayName")}</Label>
          <Input
            id={`${prefix}-displayName`}
            name="displayName"
            defaultValue={provider?.displayName ?? ""}
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor={`${prefix}-enabled`}>{t("enabled")}</Label>
          <NativeSelect
            id={`${prefix}-enabled`}
            name="enabled"
            defaultValue={String(provider?.enabled ?? true)}
          >
            <option value="true">{t("on")}</option>
            <option value="false">{t("off")}</option>
          </NativeSelect>
        </div>
      </div>

      <details className="rounded-lg border p-3">
        <summary className="cursor-pointer text-sm font-medium">{t("oidcSection")}</summary>
        <div className="mt-4 space-y-4">
          <div className="space-y-2">
            <Label htmlFor={`${prefix}-issuer`}>{t("issuer")}</Label>
            <Input id={`${prefix}-issuer`} name="issuer" defaultValue={provider?.issuer ?? ""} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor={`${prefix}-clientId`}>{t("clientId")}</Label>
              <Input
                id={`${prefix}-clientId`}
                name="clientId"
                defaultValue={provider?.clientId ?? ""}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor={`${prefix}-clientSecret`}>{t("clientSecret")}</Label>
              <Input
                id={`${prefix}-clientSecret`}
                name="clientSecret"
                type="password"
                placeholder={isEdit ? t("secretKept") : ""}
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor={`${prefix}-scopes`}>{t("scopes")}</Label>
            <Input id={`${prefix}-scopes`} name="scopes" defaultValue={provider?.scopes ?? ""} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor={`${prefix}-mapName`}>{t("mapName")}</Label>
              <Input id={`${prefix}-mapName`} name="mapName" defaultValue={cfg.mapName ?? ""} />
            </div>
            <div className="space-y-2">
              <Label htmlFor={`${prefix}-mapEmail`}>{t("mapEmail")}</Label>
              <Input id={`${prefix}-mapEmail`} name="mapEmail" defaultValue={cfg.mapEmail ?? ""} />
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor={`${prefix}-authorizationUrl`}>{t("authorizationUrl")}</Label>
              <Input
                id={`${prefix}-authorizationUrl`}
                name="authorizationUrl"
                defaultValue={cfg.authorizationUrl ?? ""}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor={`${prefix}-tokenUrl`}>{t("tokenUrl")}</Label>
              <Input id={`${prefix}-tokenUrl`} name="tokenUrl" defaultValue={cfg.tokenUrl ?? ""} />
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor={`${prefix}-userInfoUrl`}>{t("userInfoUrl")}</Label>
              <Input
                id={`${prefix}-userInfoUrl`}
                name="userInfoUrl"
                defaultValue={cfg.userInfoUrl ?? ""}
              />
            </div>
            <div className="flex items-end gap-2">
              <input
                id={`${prefix}-pkce`}
                name="pkce"
                type="checkbox"
                value="true"
                defaultChecked={cfg.pkce ?? false}
                className="size-4"
              />
              <Label htmlFor={`${prefix}-pkce`}>{t("pkce")}</Label>
            </div>
          </div>
        </div>
      </details>

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
        {pending ? t("saving") : isEdit ? t("save") : t("add")}
      </Button>
    </form>
  );
}

"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { saveAuthProviderAction } from "@/server/transport/actions/settings";
import { NAME_MAX } from "@/lib/validation/name";
import { PROVIDER_KEY_MAX, PROVIDER_TEXT_MAX } from "@/lib/validation/auth-provider";
import { useActionForm } from "@/components/forms/use-action-form";
import { FieldError } from "@/components/forms/field-error";
import { NativeSelect } from "@/components/ui/native-select";
import { AuthProviderDelete } from "@/components/admin/auth-provider-delete";
import type { AuthProviderImpact } from "@/server/services/settings/auth-providers";

export type AuthProviderDefaults = {
  key: string;
  type: string;
  displayName: string;
  enabled: boolean;
  issuer: string | null;
  clientId: string | null;
  scopes: string | null;
  allowSignUp: boolean;
  config: {
    pkce?: boolean;
    authorizationUrl?: string;
    tokenUrl?: string;
    userInfoUrl?: string;
    mapName?: string;
    mapEmail?: string;
  } | null;
};

export function AuthProviderForm({
  provider,
  impact = { linkedAccounts: 0, lockedOut: 0 },
  credentialsEnabled = true,
  appName,
}: {
  provider?: AuthProviderDefaults;
  impact?: AuthProviderImpact;
  credentialsEnabled?: boolean;
  appName: string;
}) {
  const t = useTranslations("admin.authProviders");
  const router = useRouter();
  const isEdit = Boolean(provider);
  const [type, setType] = useState(provider?.type ?? "oidc");
  const form = useActionForm(saveAuthProviderAction, {
    resetOnSuccess: !isEdit,
    onSuccess: () => {
      if (!isEdit) setType("oidc");
      router.refresh();
    },
  });
  const { state, pending } = form;

  const cfg = provider?.config ?? {};
  const prefix = provider ? `ap-${provider.key}` : "ap-new";
  const isOidc = type === "oidc";

  return (
    <form {...form.formProps} className="space-y-4">
      <input type="hidden" name="mode" value={isEdit ? "update" : "create"} />
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor={`${prefix}-key`}>{t("key")}</Label>
          <Input
            key={provider?.key ?? ""}
            id={`${prefix}-key`}
            name="key"
            defaultValue={provider?.key ?? ""}
            readOnly={isEdit}
            required
            maxLength={PROVIDER_KEY_MAX}
            {...form.fieldProps("key")}
          />
          <FieldError form={form} name="key" />
        </div>
        <div className="space-y-2">
          <Label htmlFor={`${prefix}-type`}>{t("type")}</Label>
          {provider && <input type="hidden" name="type" value={provider.type} />}
          <NativeSelect
            id={`${prefix}-type`}
            name={provider ? undefined : "type"}
            defaultValue={provider?.type ?? "oidc"}
            disabled={isEdit}
            onChange={(e) => setType(e.target.value)}
          >
            <option value="oidc">{t("typeOidc")}</option>
            <option value="google">{t("typeGoogle")}</option>
          </NativeSelect>
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor={`${prefix}-displayName`}>{t("displayName")}</Label>
          <Input
            key={provider?.displayName ?? ""}
            id={`${prefix}-displayName`}
            name="displayName"
            defaultValue={provider?.displayName ?? ""}
            required
            maxLength={NAME_MAX}
            {...form.fieldProps("displayName")}
          />
          <FieldError form={form} name="displayName" />
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
      {isOidc && (
        <div className="space-y-2">
          <Label htmlFor={`${prefix}-issuer`}>{t("issuer")}</Label>
          <Input
            key={provider?.issuer ?? ""}
            id={`${prefix}-issuer`}
            name="issuer"
            defaultValue={provider?.issuer ?? ""}
            maxLength={PROVIDER_TEXT_MAX}
            {...form.fieldProps("issuer")}
          />
          <FieldError form={form} name="issuer" />
        </div>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor={`${prefix}-clientId`}>{t("clientId")}</Label>
          <Input
            key={provider?.clientId ?? ""}
            id={`${prefix}-clientId`}
            name="clientId"
            defaultValue={provider?.clientId ?? ""}
            maxLength={PROVIDER_TEXT_MAX}
            {...form.fieldProps("clientId")}
          />
          <FieldError form={form} name="clientId" />
        </div>
        <div className="space-y-2">
          <Label htmlFor={`${prefix}-clientSecret`}>{t("clientSecret")}</Label>
          <Input
            id={`${prefix}-clientSecret`}
            name="clientSecret"
            type="password"
            placeholder={isEdit ? t("secretKept") : ""}
            {...form.fieldProps("clientSecret")}
          />
          <FieldError form={form} name="clientSecret" />
        </div>
      </div>
      {!isOidc && <p className="text-muted-foreground text-xs">{t("googleHint")}</p>}
      <div className="flex items-start gap-2">
        <input
          id={`${prefix}-allowSignUp`}
          name="allowSignUp"
          type="checkbox"
          value="true"
          defaultChecked={provider?.allowSignUp ?? false}
          aria-describedby={`${prefix}-allowSignUp-hint`}
          className="mt-0.5 size-4"
        />
        <div className="space-y-1">
          <Label htmlFor={`${prefix}-allowSignUp`}>{t("allowSignUp")}</Label>
          <p id={`${prefix}-allowSignUp-hint`} className="text-muted-foreground text-xs">
            {t("allowSignUpHint", { appName })}
          </p>
        </div>
      </div>

      {isOidc && (
        <details className="rounded-lg border p-3">
          <summary className="cursor-pointer text-sm font-medium">{t("oidcSection")}</summary>
          <div className="mt-4 space-y-4">
            <div className="space-y-2">
              <Label htmlFor={`${prefix}-scopes`}>{t("scopes")}</Label>
              <Input
                key={provider?.scopes ?? ""}
                id={`${prefix}-scopes`}
                name="scopes"
                defaultValue={provider?.scopes ?? ""}
                maxLength={PROVIDER_TEXT_MAX}
                {...form.fieldProps("scopes")}
              />
              <FieldError form={form} name="scopes" />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor={`${prefix}-mapName`}>{t("mapName")}</Label>
                <Input
                  key={cfg.mapName ?? ""}
                  id={`${prefix}-mapName`}
                  name="mapName"
                  defaultValue={cfg.mapName ?? ""}
                  {...form.fieldProps("mapName")}
                />
                <FieldError form={form} name="mapName" />
              </div>
              <div className="space-y-2">
                <Label htmlFor={`${prefix}-mapEmail`}>{t("mapEmail")}</Label>
                <Input
                  key={cfg.mapEmail ?? ""}
                  id={`${prefix}-mapEmail`}
                  name="mapEmail"
                  defaultValue={cfg.mapEmail ?? ""}
                  {...form.fieldProps("mapEmail")}
                />
                <FieldError form={form} name="mapEmail" />
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor={`${prefix}-authorizationUrl`}>{t("authorizationUrl")}</Label>
                <Input
                  key={cfg.authorizationUrl ?? ""}
                  id={`${prefix}-authorizationUrl`}
                  name="authorizationUrl"
                  defaultValue={cfg.authorizationUrl ?? ""}
                  {...form.fieldProps("authorizationUrl")}
                />
                <FieldError form={form} name="authorizationUrl" />
              </div>
              <div className="space-y-2">
                <Label htmlFor={`${prefix}-tokenUrl`}>{t("tokenUrl")}</Label>
                <Input
                  key={cfg.tokenUrl ?? ""}
                  id={`${prefix}-tokenUrl`}
                  name="tokenUrl"
                  defaultValue={cfg.tokenUrl ?? ""}
                  {...form.fieldProps("tokenUrl")}
                />
                <FieldError form={form} name="tokenUrl" />
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor={`${prefix}-userInfoUrl`}>{t("userInfoUrl")}</Label>
                <Input
                  key={cfg.userInfoUrl ?? ""}
                  id={`${prefix}-userInfoUrl`}
                  name="userInfoUrl"
                  defaultValue={cfg.userInfoUrl ?? ""}
                  {...form.fieldProps("userInfoUrl")}
                />
                <FieldError form={form} name="userInfoUrl" />
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
      )}

      {state?.ok && (
        <Alert>
          <AlertDescription>{t("saved")}</AlertDescription>
        </Alert>
      )}
      {state && !state.ok && (
        <Alert variant="destructive">
          <AlertDescription>
            {t(`error.${state.error}`, { count: state.count ?? 0 })}
          </AlertDescription>
        </Alert>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? t("saving") : isEdit ? t("save") : t("add")}
        </Button>
        {provider && (
          <AuthProviderDelete
            providerKey={provider.key}
            name={provider.displayName}
            impact={impact}
            credentialsEnabled={credentialsEnabled}
          />
        )}
      </div>
    </form>
  );
}

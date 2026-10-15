"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { testOidcConnectionAction, type OidcTestResult } from "@/server/transport/actions/setup";
import type { OidcData } from "./stepper";

// Optional. More providers can be added later in the admin settings (Phase 8.4),
// backed by the dynamic-provider service from scope 1.2. If the issuer is left
// blank the step is skipped; if filled, the required fields are validated.
export function StepOidc({
  data,
  onChange,
  onNext,
  callbackUrl,
}: {
  data: OidcData;
  onChange: (p: Partial<OidcData>) => void;
  onNext: () => void;
  callbackUrl: string;
}) {
  const t = useTranslations("setup.oidc");
  const [showError, setShowError] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [testResult, setTestResult] = useState<OidcTestResult | null>(null);
  const [testing, startTest] = useTransition();

  const filled = data.issuer.trim().length > 0;
  const complete =
    /^https?:\/\/.+/.test(data.issuer.trim()) &&
    data.clientId.trim().length > 0 &&
    data.clientSecret.length > 0;

  function handleNext() {
    if (filled && !complete) {
      setShowError(true);
      return;
    }
    onNext();
  }

  function handleTest() {
    setTestResult(null);
    startTest(async () => {
      setTestResult(await testOidcConnectionAction(data.issuer));
    });
  }

  return (
    <div className="space-y-4">
      <Alert>
        <AlertDescription>{t("description")}</AlertDescription>
      </Alert>

      <div className="space-y-2">
        <Label htmlFor="oidc-redirect">{t("redirectUri")}</Label>
        <Input
          id="oidc-redirect"
          readOnly
          value={callbackUrl}
          onFocus={(e) => e.currentTarget.select()}
          className="font-mono text-xs"
        />
        <p className="text-muted-foreground text-xs">{t("redirectUriHint")}</p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="oidc-name">{t("displayName")}</Label>
        <Input
          id="oidc-name"
          value={data.displayName}
          onChange={(e) => onChange({ displayName: e.target.value })}
          placeholder={t("displayNamePlaceholder")}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="oidc-issuer">{t("issuer")}</Label>
        <Input
          id="oidc-issuer"
          type="url"
          value={data.issuer}
          onChange={(e) => onChange({ issuer: e.target.value })}
          placeholder="https://idp.example.com"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="oidc-client-id">{t("clientId")}</Label>
        <Input
          id="oidc-client-id"
          value={data.clientId}
          onChange={(e) => onChange({ clientId: e.target.value })}
          autoComplete="off"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="oidc-client-secret">{t("clientSecret")}</Label>
        <Input
          id="oidc-client-secret"
          type="password"
          value={data.clientSecret}
          onChange={(e) => onChange({ clientSecret: e.target.value })}
          autoComplete="off"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="oidc-scopes">{t("scopes")}</Label>
        <Input
          id="oidc-scopes"
          value={data.scopes}
          onChange={(e) => onChange({ scopes: e.target.value })}
          placeholder="openid,email,profile"
        />
      </div>
      <p className="text-muted-foreground text-xs">{t("signUpHint")}</p>

      <div className="flex items-center gap-3">
        <Button type="button" variant="outline" onClick={handleTest} disabled={!filled || testing}>
          {testing ? t("testing") : t("test")}
        </Button>
        {testResult?.ok && <span className="text-sm text-emerald-600">{t("testOk")}</span>}
        {testResult && !testResult.ok && (
          <span className="text-destructive text-sm">
            {t("testFailed")} ({testResult.error})
          </span>
        )}
      </div>

      <button
        type="button"
        className="text-muted-foreground hover:text-foreground text-sm underline"
        onClick={() => setShowAdvanced((v) => !v)}
      >
        {t("advanced")}
      </button>

      {showAdvanced && (
        <div className="border-border space-y-4 rounded-lg border p-4">
          <div className="flex items-center gap-3">
            <Switch
              id="oidc-pkce"
              checked={data.pkce}
              onCheckedChange={(v) => onChange({ pkce: v })}
            />
            <Label htmlFor="oidc-pkce">{t("pkce")}</Label>
          </div>
          <p className="text-muted-foreground text-xs">{t("endpointsHint")}</p>
          <div className="space-y-2">
            <Label htmlFor="oidc-auth-url">{t("authorizationUrl")}</Label>
            <Input
              id="oidc-auth-url"
              type="url"
              value={data.authorizationUrl}
              onChange={(e) => onChange({ authorizationUrl: e.target.value })}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="oidc-token-url">{t("tokenUrl")}</Label>
            <Input
              id="oidc-token-url"
              type="url"
              value={data.tokenUrl}
              onChange={(e) => onChange({ tokenUrl: e.target.value })}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="oidc-userinfo-url">{t("userInfoUrl")}</Label>
            <Input
              id="oidc-userinfo-url"
              type="url"
              value={data.userInfoUrl}
              onChange={(e) => onChange({ userInfoUrl: e.target.value })}
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="oidc-map-name">{t("mapName")}</Label>
              <Input
                id="oidc-map-name"
                value={data.mapName}
                onChange={(e) => onChange({ mapName: e.target.value })}
                placeholder="name"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="oidc-map-email">{t("mapEmail")}</Label>
              <Input
                id="oidc-map-email"
                value={data.mapEmail}
                onChange={(e) => onChange({ mapEmail: e.target.value })}
                placeholder="email"
              />
            </div>
          </div>
        </div>
      )}

      {showError && filled && !complete && (
        <Alert variant="destructive">
          <AlertDescription>{t("error")}</AlertDescription>
        </Alert>
      )}
      <Button
        type="button"
        variant={filled ? "default" : "outline"}
        className="w-full"
        onClick={handleNext}
      >
        {filled ? t("save") : t("skip")}
      </Button>
    </div>
  );
}

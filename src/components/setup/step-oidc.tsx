"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import type { OidcData } from "./stepper";

// Optional. More providers can be added later in the admin settings (Phase 8.4),
// backed by the dynamic-provider service from scope 1.2. If the issuer is left
// blank the step is skipped; if filled, the required fields are validated.
export function StepOidc({
  data,
  onChange,
  onNext,
}: {
  data: OidcData;
  onChange: (p: Partial<OidcData>) => void;
  onNext: () => void;
}) {
  const t = useTranslations("setup.oidc");
  const [showError, setShowError] = useState(false);

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

  return (
    <div className="space-y-4">
      <Alert>
        <AlertDescription>{t("description")}</AlertDescription>
      </Alert>
      <div className="space-y-2">
        <Label htmlFor="oidc-name">{t("displayName")}</Label>
        <Input
          id="oidc-name"
          value={data.displayName}
          onChange={(e) => onChange({ displayName: e.target.value })}
          placeholder="Mon SSO"
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

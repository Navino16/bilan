"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { authClient } from "@/lib/auth-client";

function secretFromUri(uri: string): string {
  try {
    return new URL(uri).searchParams.get("secret") ?? uri;
  } catch {
    return uri;
  }
}

export function TwoFactorControls({ enabled }: { enabled: boolean }) {
  const t = useTranslations("settings.security");
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  // After enable(): the TOTP URI + backup codes to show before verification.
  const [enrol, setEnrol] = useState<{ uri: string; backupCodes: string[] } | null>(null);

  async function beginEnable() {
    setError(null);
    setPending(true);
    const res = await authClient.twoFactor.enable({ password });
    setPending(false);
    if (res.error || !res.data) return setError("BAD_PASSWORD");
    setEnrol({ uri: res.data.totpURI, backupCodes: res.data.backupCodes });
    setPassword("");
  }

  async function verify() {
    setError(null);
    setPending(true);
    const res = await authClient.twoFactor.verifyTotp({ code });
    setPending(false);
    if (res.error) return setError("BAD_CODE");
    setEnrol(null);
    setCode("");
    router.refresh();
  }

  async function disable() {
    setError(null);
    setPending(true);
    const res = await authClient.twoFactor.disable({ password });
    setPending(false);
    if (res.error) return setError("BAD_PASSWORD");
    setPassword("");
    router.refresh();
  }

  // Enabled → offer disable.
  if (enabled) {
    return (
      <div className="space-y-4" data-slot="two-factor-controls">
        <p className="text-sm">{t("statusEnabled")}</p>
        <div className="space-y-2">
          <Label htmlFor="tfa-pw-disable">{t("password")}</Label>
          <Input
            id="tfa-pw-disable"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
          />
        </div>
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{t(`error.${error}`)}</AlertDescription>
          </Alert>
        )}
        <Button variant="destructive" onClick={disable} disabled={pending || !password}>
          {pending ? t("working") : t("disable")}
        </Button>
      </div>
    );
  }

  // Mid-enrolment → show secret + backup codes, then verify a code.
  if (enrol) {
    return (
      <div className="space-y-4" data-slot="two-factor-controls">
        <p className="text-sm">{t("scanHint")}</p>
        <div className="space-y-1">
          <Label>{t("secret")}</Label>
          <code className="bg-muted block rounded-md px-3 py-2 text-sm break-all">
            {secretFromUri(enrol.uri)}
          </code>
        </div>
        <div className="space-y-1">
          <Label>{t("backupCodes")}</Label>
          <ul className="bg-muted grid grid-cols-2 gap-1 rounded-md p-3 font-mono text-xs">
            {enrol.backupCodes.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        </div>
        <div className="space-y-2">
          <Label htmlFor="tfa-code">{t("code")}</Label>
          <Input
            id="tfa-code"
            inputMode="numeric"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            autoComplete="one-time-code"
          />
        </div>
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{t(`error.${error}`)}</AlertDescription>
          </Alert>
        )}
        <Button onClick={verify} disabled={pending || code.length < 6}>
          {pending ? t("working") : t("verify")}
        </Button>
      </div>
    );
  }

  // Disabled → offer enable (password-gated).
  return (
    <div className="space-y-4" data-slot="two-factor-controls">
      <p className="text-sm">{t("statusDisabled")}</p>
      <div className="space-y-2">
        <Label htmlFor="tfa-pw-enable">{t("password")}</Label>
        <Input
          id="tfa-pw-enable"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
        />
      </div>
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{t(`error.${error}`)}</AlertDescription>
        </Alert>
      )}
      <Button onClick={beginEnable} disabled={pending || !password}>
        {pending ? t("working") : t("enable")}
      </Button>
    </div>
  );
}

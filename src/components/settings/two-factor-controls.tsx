"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { authClient } from "@/lib/auth-client";
import {
  disableTwoFactorAction,
  enableTwoFactorAction,
} from "@/server/transport/actions/two-factor";
import { TotpQr } from "./totp-qr";

function secretFromUri(uri: string): string {
  try {
    const secret = new URL(uri).searchParams.get("secret") ?? uri;
    return secret.replace(/(.{4})/g, "$1 ").trim();
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
  const [retryAfter, setRetryAfter] = useState<number | undefined>();
  const [pending, setPending] = useState(false);
  // After enable(): the TOTP URI + backup codes to show before verification.
  const [enrol, setEnrol] = useState<{ uri: string; backupCodes: string[] } | null>(null);

  // Shared submit wrapper: a thrown action or fetch still clears the pending state.
  async function submit(e: React.FormEvent, run: () => Promise<void>) {
    e.preventDefault();
    setError(null);
    setRetryAfter(undefined);
    setPending(true);
    try {
      await run();
    } catch {
      setError("FAILED");
    } finally {
      setPending(false);
    }
  }

  function fail(res: { error: string; retryAfter?: number }) {
    setError(res.error);
    setRetryAfter(res.retryAfter);
  }

  const beginEnable = (e: React.FormEvent) =>
    submit(e, async () => {
      const res = await enableTwoFactorAction(password);
      if (!res.ok) return fail(res);
      setEnrol({ uri: res.data.totpURI, backupCodes: res.data.backupCodes });
      setPassword("");
    });

  const verify = (e: React.FormEvent) =>
    submit(e, async () => {
      const res = await authClient.twoFactor.verifyTotp({ code: code.replace(/\s/g, "") });
      if (res.error) return setError("BAD_CODE");
      setEnrol(null);
      setCode("");
      router.refresh();
    });

  const disable = (e: React.FormEvent) =>
    submit(e, async () => {
      const res = await disableTwoFactorAction(password, code);
      if (!res.ok) return fail(res);
      setPassword("");
      setCode("");
      router.refresh();
    });

  const errorText =
    error === "RATE_LIMITED" && retryAfter
      ? t("error.rateLimitedFor", { minutes: Math.ceil(retryAfter / 60) })
      : error && t(`error.${error}`);

  // Enabled → offer disable.
  if (enabled) {
    return (
      <form onSubmit={disable} className="space-y-4" data-slot="two-factor-controls">
        <p className="text-sm">{t("statusEnabled")}</p>
        <div className="space-y-2 sm:w-1/2">
          <Label htmlFor="tfa-pw-disable">{t("password")}</Label>
          <Input
            id="tfa-pw-disable"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
          />
        </div>
        <div className="space-y-2 sm:w-1/2">
          <Label htmlFor="tfa-code-disable">{t("disableCode")}</Label>
          <Input
            id="tfa-code-disable"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            autoComplete="one-time-code"
            aria-describedby="tfa-code-disable-hint"
            className="font-mono"
          />
          <p id="tfa-code-disable-hint" className="text-muted-foreground text-xs">
            {t("disableCodeHint")}
          </p>
        </div>
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{errorText}</AlertDescription>
          </Alert>
        )}
        <Button type="submit" variant="destructive" disabled={pending || !password || !code.trim()}>
          {pending ? t("working") : t("disable")}
        </Button>
      </form>
    );
  }

  // Mid-enrolment.
  if (enrol) {
    return (
      <form onSubmit={verify} className="space-y-4" data-slot="two-factor-controls">
        <p className="text-sm">{t("enrolScan")}</p>
        <div className="flex flex-wrap items-start gap-4">
          <TotpQr uri={enrol.uri} label={t("qrLabel")} />
          <div className="min-w-44 flex-1 space-y-1">
            <p className="text-muted-foreground text-xs">{t("enrolManual")}</p>
            <code className="bg-muted block rounded-md px-3 py-2 text-xs break-all">
              {secretFromUri(enrol.uri)}
            </code>
          </div>
        </div>
        <p className="text-sm">{t("enrolBackup")}</p>
        <ul
          aria-label={t("backupCodes")}
          className="bg-muted grid grid-cols-2 gap-1 rounded-md p-3 font-mono text-xs sm:grid-cols-4"
        >
          {enrol.backupCodes.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
        <div className="space-y-2">
          <Label htmlFor="tfa-code" className="font-normal">
            {t("enrolVerify")}
          </Label>
          <div className="flex gap-2">
            <Input
              id="tfa-code"
              inputMode="numeric"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              autoComplete="one-time-code"
              placeholder="000000"
              className="max-w-40 font-mono tracking-[0.3em]"
            />
            <Button type="submit" disabled={pending || code.replace(/\s/g, "").length < 6}>
              {pending ? t("working") : t("verify")}
            </Button>
          </div>
        </div>
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{errorText}</AlertDescription>
          </Alert>
        )}
      </form>
    );
  }

  // Disabled → offer enable (password-gated).
  return (
    <form onSubmit={beginEnable} className="space-y-4" data-slot="two-factor-controls">
      <p className="text-sm">{t("statusDisabled")}</p>
      <div className="space-y-2 sm:w-1/2">
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
          <AlertDescription>{errorText}</AlertDescription>
        </Alert>
      )}
      <Button type="submit" disabled={pending || !password}>
        {pending ? t("working") : t("enable")}
      </Button>
    </form>
  );
}

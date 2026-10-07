"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { authClient } from "@/lib/auth-client";

type Mode = "totp" | "backup";

export function TwoFactorStep({ locale, onBack }: { locale: string; onBack: () => void }) {
  const t = useTranslations("auth.twoFactor");
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("totp");
  const [code, setCode] = useState("");
  const [trustDevice, setTrustDevice] = useState(false);
  const [error, setError] = useState<"badCode" | "expired" | "rateLimited" | "slowDown" | null>(
    null,
  );
  const [pending, setPending] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setPending(true);
    const res =
      mode === "totp"
        ? await authClient.twoFactor.verifyTotp({ code: code.replace(/\s/g, ""), trustDevice })
        : await authClient.twoFactor.verifyBackupCode({ code: code.trim(), trustDevice });
    if (res.error) {
      setPending(false);
      const errCode = (res.error as { code?: string }).code;
      // TOO_MANY_ATTEMPTS burns the pending sign-in; any other 429 is Better Auth's
      // short per-IP throttle.
      if (errCode === "TOO_MANY_ATTEMPTS") return setError("rateLimited");
      if (res.error.status === 429) return setError("slowDown");
      return setError(errCode === "INVALID_TWO_FACTOR_COOKIE" ? "expired" : "badCode");
    }
    router.push(`/${locale}/dashboard`);
  }

  function switchMode() {
    setMode(mode === "totp" ? "backup" : "totp");
    setCode("");
    setError(null);
  }

  return (
    <div className="space-y-6" data-slot="two-factor-step">
      <header className="text-center">
        <h1 className="font-display text-3xl">{t("title")}</h1>
        <p className="text-muted-foreground mt-2 text-sm">
          {mode === "totp" ? t("hint") : t("backupHint")}
        </p>
      </header>
      <form onSubmit={submit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="tfa-login-code">{mode === "totp" ? t("code") : t("backupCode")}</Label>
          <Input
            id="tfa-login-code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            required
            autoFocus
            autoComplete={mode === "totp" ? "one-time-code" : "off"}
            inputMode={mode === "totp" ? "numeric" : "text"}
            className="h-12 text-center font-mono text-xl tracking-[0.4em]"
          />
        </div>
        <div className="space-y-1">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={trustDevice}
              onChange={(e) => setTrustDevice(e.target.checked)}
              aria-describedby="tfa-trust-hint"
              className="border-input size-4 rounded border"
            />
            {t("trustDevice")}
          </label>
          <p id="tfa-trust-hint" className="text-muted-foreground pl-6 text-xs">
            {t("trustDeviceHint")}
          </p>
        </div>
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{t(`error.${error}`)}</AlertDescription>
          </Alert>
        )}
        <Button type="submit" className="w-full" disabled={pending || !code.trim()}>
          {pending ? t("submitting") : t("submit")}
        </Button>
      </form>
      <div className="flex items-center justify-between gap-3 text-sm">
        <button
          type="button"
          onClick={onBack}
          className="text-muted-foreground hover:text-foreground hover:underline"
        >
          <span aria-hidden="true">←</span> {t("back")}
        </button>
        <button type="button" onClick={switchMode} className="text-right hover:underline">
          {mode === "totp" ? t("useBackup") : t("useTotp")}
        </button>
      </div>
    </div>
  );
}

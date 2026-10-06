"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { signIn } from "@/lib/auth-client";

export function PasskeySignIn({ locale }: { locale: string }) {
  const t = useTranslations("auth.login");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<"passkeyNotFound" | "passkeyFailed" | null>(null);

  function run() {
    setError(null);
    startTransition(async () => {
      const res = await signIn.passkey();
      if (res?.error) {
        const code = "code" in res.error ? res.error.code : undefined;
        return setError(code === "PASSKEY_NOT_FOUND" ? "passkeyNotFound" : "passkeyFailed");
      }
      router.push(`/${locale}/dashboard`);
    });
  }

  return (
    <div className="space-y-4">
      <div className="text-muted-foreground flex items-center gap-3 text-xs">
        <span className="bg-border h-px flex-1" />
        {t("or")}
        <span className="bg-border h-px flex-1" />
      </div>
      <Button type="button" variant="outline" className="w-full" disabled={pending} onClick={run}>
        <KeyRound />
        {t("passkey")}
      </Button>
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{t(`error.${error}`)}</AlertDescription>
        </Alert>
      )}
    </div>
  );
}

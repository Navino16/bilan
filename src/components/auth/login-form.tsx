"use client";

import { useActionState, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "./password-input";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { loginAction } from "@/server/transport/actions/auth";
import { PasskeySignIn } from "./passkey-sign-in";
import { TwoFactorStep } from "./two-factor-step";

export type LoginNotice = "passwordReset" | "accountDeleted";
export type SsoError = "disabled" | "ssoFailed" | "ssoSignUpDisabled" | "ssoNotLinked";

// "Back" from the code step remounts the password step to clear its action state.
export function LoginForm({
  locale,
  redirectTo,
  notice,
  ssoError,
}: {
  locale: string;
  redirectTo: string;
  notice?: LoginNotice;
  ssoError?: SsoError;
}) {
  const [attempt, setAttempt] = useState(0);
  return (
    <PasswordStep
      key={attempt}
      locale={locale}
      redirectTo={redirectTo}
      notice={notice}
      ssoError={ssoError}
      onRestart={() => setAttempt((n) => n + 1)}
    />
  );
}

function PasswordStep({
  locale,
  redirectTo,
  notice,
  ssoError,
  onRestart,
}: {
  locale: string;
  redirectTo: string;
  notice?: LoginNotice;
  ssoError?: SsoError;
  onRestart: () => void;
}) {
  const t = useTranslations("auth.login");
  const router = useRouter();
  const [state, action, pending] = useActionState(loginAction, null);

  useEffect(() => {
    if (state?.ok && !state.twoFactor) router.push(redirectTo);
  }, [state, router, redirectTo]);

  if (state?.ok && state.twoFactor)
    return <TwoFactorStep redirectTo={redirectTo} onBack={onRestart} />;

  return (
    <div className="space-y-6">
      <header className="text-center">
        <h1 className="font-display text-3xl">{t("title")}</h1>
      </header>
      {notice && !state && (
        <Alert>
          <AlertDescription>{t(`notice.${notice}`)}</AlertDescription>
        </Alert>
      )}
      {ssoError && !state && (
        <Alert variant="destructive">
          <AlertDescription>{t(`error.${ssoError}`)}</AlertDescription>
        </Alert>
      )}
      <div className="space-y-4">
        <form action={action} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">{t("email")}</Label>
            <Input id="email" name="email" type="email" required autoComplete="email" />
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="password">{t("password")}</Label>
              <Link
                href={`/${locale}/reset`}
                className="text-muted-foreground text-xs hover:underline"
              >
                {t("forgot")}
              </Link>
            </div>
            <PasswordInput id="password" name="password" required autoComplete="current-password" />
          </div>
          {state && !state.ok && (
            <Alert variant="destructive">
              <AlertDescription>
                {state.error === "DISABLED"
                  ? t("error.disabled")
                  : state.error !== "RATE_LIMITED"
                    ? t("error.badCredentials")
                    : state.retryAfter
                      ? t("error.rateLimitedFor", { minutes: Math.ceil(state.retryAfter / 60) })
                      : t("error.rateLimited")}
              </AlertDescription>
            </Alert>
          )}
          <Button type="submit" className="w-full" disabled={pending}>
            {pending ? t("submitting") : t("submit")}
          </Button>
        </form>
        <PasskeySignIn redirectTo={redirectTo} />
      </div>
      <p className="text-muted-foreground text-center text-sm">
        {t("noAccount")}{" "}
        <Link href={`/${locale}/register`} className="text-foreground hover:underline">
          {t("registerLink")}
        </Link>
      </p>
    </div>
  );
}

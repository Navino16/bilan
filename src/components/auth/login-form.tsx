"use client";

import { useActionState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { loginAction } from "@/server/transport/actions/auth";
import { PasskeySignIn } from "./passkey-sign-in";

export function LoginForm({ locale }: { locale: string }) {
  const t = useTranslations("auth.login");
  const router = useRouter();
  const [state, action, pending] = useActionState(loginAction, null);

  useEffect(() => {
    if (state?.ok) router.push(`/${locale}/dashboard`);
  }, [state, router, locale]);

  return (
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
          <Input
            id="password"
            name="password"
            type="password"
            required
            autoComplete="current-password"
          />
        </div>
        {state && !state.ok && (
          <Alert variant="destructive">
            <AlertDescription>
              {state.error === "RATE_LIMITED" ? t("error.rateLimited") : t("error.badCredentials")}
            </AlertDescription>
          </Alert>
        )}
        <Button type="submit" className="w-full" disabled={pending}>
          {pending ? t("submitting") : t("submit")}
        </Button>
      </form>
      <PasskeySignIn locale={locale} />
    </div>
  );
}

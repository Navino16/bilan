"use client";

import { useActionState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { resetConfirmAction } from "@/server/transport/actions/auth";

export function ResetConfirmForm({ token, locale }: { token: string; locale: string }) {
  const t = useTranslations("auth.resetConfirm");
  const router = useRouter();
  const [state, action, pending] = useActionState(resetConfirmAction, null);

  useEffect(() => {
    if (state?.ok) router.push(`/${locale}/login?reset=1`);
  }, [state, router, locale]);

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="token" value={token} />
      <div className="space-y-2">
        <Label htmlFor="password">{t("password")}</Label>
        <Input
          id="password"
          name="password"
          type="password"
          required
          minLength={12}
          autoComplete="new-password"
        />
        <p className="text-muted-foreground text-xs">{t("passwordHint")}</p>
      </div>
      {state && !state.ok && (
        <Alert variant="destructive">
          <AlertDescription>
            {state.error === "INVALID_TOKEN" ? t("error.invalidToken") : t("error.invalid")}
          </AlertDescription>
        </Alert>
      )}
      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? t("submitting") : t("submit")}
      </Button>
    </form>
  );
}

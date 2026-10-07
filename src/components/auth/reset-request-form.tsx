"use client";

import { useActionState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { resetRequestAction } from "@/server/transport/actions/auth";

export function ResetRequestForm() {
  const t = useTranslations("auth.reset");
  const locale = useLocale();
  const [state, action, pending] = useActionState(resetRequestAction, null);

  if (state?.ok) {
    return (
      <Alert>
        <AlertDescription>{t("sent")}</AlertDescription>
      </Alert>
    );
  }

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="locale" value={locale} />
      <div className="space-y-2">
        <Label htmlFor="email">{t("email")}</Label>
        <Input id="email" name="email" type="email" required autoComplete="email" />
      </div>
      {state && !state.ok && (
        <Alert variant="destructive">
          <AlertDescription>
            {state.error === "RATE_LIMITED" ? t("error.rateLimited") : t("error.invalid")}
          </AlertDescription>
        </Alert>
      )}
      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? t("submitting") : t("submit")}
      </Button>
    </form>
  );
}

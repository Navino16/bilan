"use client";

import { useActionState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { registerAction } from "@/server/transport/actions/auth";

export function RegisterForm({ locale, mode }: { locale: string; mode: string }) {
  const t = useTranslations("auth.register");
  const router = useRouter();
  const params = useSearchParams();
  const [state, action, pending] = useActionState(registerAction, null);

  useEffect(() => {
    if (state?.ok) router.push(`/${locale}/dashboard`);
  }, [state, router, locale]);

  if (mode === "DISABLED") {
    return (
      <Alert>
        <AlertDescription>{t("closed")}</AlertDescription>
      </Alert>
    );
  }

  const inviteOnly = mode === "INVITE_ONLY";

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="invitationToken" value={params.get("invitation") ?? ""} />
      {inviteOnly ? (
        <div className="space-y-2">
          <Label htmlFor="adminToken">{t("token")}</Label>
          <Input
            id="adminToken"
            name="adminToken"
            required
            defaultValue={params.get("adminToken") ?? ""}
          />
          <p className="text-muted-foreground text-xs">{t("tokenHint")}</p>
        </div>
      ) : (
        <input type="hidden" name="adminToken" value={params.get("adminToken") ?? ""} />
      )}
      <div className="space-y-2">
        <Label htmlFor="name">{t("name")}</Label>
        <Input id="name" name="name" required autoComplete="name" />
      </div>
      <div className="space-y-2">
        <Label htmlFor="email">{t("email")}</Label>
        <Input id="email" name="email" type="email" required autoComplete="email" />
      </div>
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
          <AlertDescription>{t(`error.${state.error}`)}</AlertDescription>
        </Alert>
      )}
      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? t("submitting") : t("submit")}
      </Button>
    </form>
  );
}

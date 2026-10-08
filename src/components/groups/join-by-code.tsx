"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { acceptInvitationAction } from "@/server/transport/actions/invitations";
import { useActionForm } from "@/components/forms/use-action-form";

export function JoinByCode() {
  const t = useTranslations("invitations");
  const locale = useLocale();
  const router = useRouter();
  const [redirecting, setRedirecting] = useState(false);
  const form = useActionForm(acceptInvitationAction, {
    resetOnSuccess: false,
    onSuccess: (result) => {
      setRedirecting(true);
      router.push(`/${locale}/groups/${result.groupId}`);
    },
  });
  const { state, pending } = form;
  const error = state && !state.ok ? state : null;

  return (
    <form {...form.formProps} className="flex flex-col gap-2 sm:flex-row sm:items-start">
      <div className="flex-1">
        <Input
          name="code"
          required
          autoComplete="off"
          placeholder={t("joinPlaceholder")}
          aria-label={t("joinByCode")}
          className="uppercase"
          aria-describedby="join-code-hint"
        />
        <p id="join-code-hint" className="text-muted-foreground mt-1 text-xs">
          {t("joinCodeHint")}
        </p>
        {error && (
          <Alert variant="destructive" className="mt-2">
            <AlertDescription>
              {t(`error.${error.error}`, { email: error.hint ?? "" })}
            </AlertDescription>
          </Alert>
        )}
      </div>
      <Button type="submit" variant="outline" disabled={pending || redirecting}>
        {pending || redirecting ? t("joining") : t("join")}
      </Button>
    </form>
  );
}

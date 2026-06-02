"use client";

import { useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { acceptInvitationAction } from "@/server/transport/actions/invitations";

export function JoinByCode() {
  const t = useTranslations("invitations");
  const locale = useLocale();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [redirecting, setRedirecting] = useState(false);

  function handleAction(formData: FormData) {
    startTransition(async () => {
      const result = await acceptInvitationAction(null, formData);
      if (result?.ok) {
        setError(null);
        setRedirecting(true);
        router.push(`/${locale}/groups/${result.groupId}`);
      } else {
        setError(result?.error ?? "FAILED");
      }
    });
  }

  return (
    <form action={handleAction} className="flex flex-col gap-2 sm:flex-row sm:items-start">
      <div className="flex-1">
        <Input
          name="code"
          required
          autoComplete="off"
          placeholder={t("joinPlaceholder")}
          className="uppercase"
        />
        {error && (
          <Alert variant="destructive" className="mt-2">
            <AlertDescription>{t(`error.${error}`)}</AlertDescription>
          </Alert>
        )}
      </div>
      <Button type="submit" variant="outline" disabled={pending || redirecting}>
        {pending || redirecting ? t("joining") : t("join")}
      </Button>
    </form>
  );
}

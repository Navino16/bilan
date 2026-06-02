"use client";

import { useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { acceptInvitationAction } from "@/server/transport/actions/invitations";

export function JoinConfirm({ token }: { token: string }) {
  const t = useTranslations("invitations");
  const locale = useLocale();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [redirecting, setRedirecting] = useState(false);

  function accept() {
    startTransition(async () => {
      const fd = new FormData();
      fd.set("token", token);
      const result = await acceptInvitationAction(null, fd);
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
    <div className="space-y-3">
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{t(`error.${error}`)}</AlertDescription>
        </Alert>
      )}
      <Button onClick={accept} disabled={pending || redirecting}>
        <Check />
        {pending || redirecting ? t("accepting") : t("accept")}
      </Button>
    </div>
  );
}

"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { MailWarning } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  resendVerificationEmailAction,
  type ResendVerificationState,
} from "@/server/transport/actions/email-verification";

export function VerifyEmailBanner({ email }: { email: string }) {
  const t = useTranslations("shell.verifyEmail");
  const router = useRouter();
  const [result, setResult] = useState<ResendVerificationState | null>(null);
  const [pending, startTransition] = useTransition();

  function resend() {
    startTransition(async () => {
      const res = await resendVerificationEmailAction().catch(
        (): ResendVerificationState => ({ ok: false, error: "FAILED" }),
      );
      if (res.ok && res.status === "ALREADY_VERIFIED") return router.refresh();
      setResult(res);
    });
  }

  return (
    // A region, not the default role="alert": it would be announced again on every page.
    <Alert data-slot="verify-email-banner" role="region" aria-label={t("title")}>
      <MailWarning />
      <AlertTitle>{t("title")}</AlertTitle>
      <AlertDescription className="space-y-2">
        <p className="wrap-anywhere">{t("body", { email })}</p>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <Button size="sm" variant="outline" onClick={resend} disabled={pending}>
            {pending ? t("sending") : t("resend")}
          </Button>
          <span
            aria-live="polite"
            className={result?.ok === false ? "text-destructive" : undefined}
          >
            {result && (result.ok ? t("sent") : t(`error.${result.error}`))}
          </span>
        </div>
      </AlertDescription>
    </Alert>
  );
}

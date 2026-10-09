"use client";

import { useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { Check } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { SectionCard } from "@/components/shell/section-card";
import { acceptInvitationAction } from "@/server/transport/actions/invitations";

export type PendingForUser = { token: string; groupName: string; role: string };

export function PendingInvitations({ invitations }: { invitations: PendingForUser[] }) {
  const t = useTranslations("invitations");
  const tg = useTranslations("groups");
  const locale = useLocale();
  const router = useRouter();
  const [error, setError] = useState<{ code: string; hint?: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function accept(token: string) {
    setBusy(token);
    startTransition(async () => {
      const fd = new FormData();
      fd.set("token", token);
      const result = await acceptInvitationAction(null, fd);
      if (result?.ok) {
        setError(null);
        router.push(`/${locale}/groups/${result.groupId}`);
      } else {
        setBusy(null);
        setError(result ? { code: result.error, hint: result.hint } : { code: "FAILED" });
      }
    });
  }

  if (invitations.length === 0) return null;

  return (
    <SectionCard flush overline={t("forYouOverline")} title={t("pendingForYou")}>
      {error && (
        <div className="border-b px-4 py-3 sm:px-6">
          <Alert variant="destructive">
            <AlertDescription>
              {t(`error.${error.code}`, { email: error.hint ?? "" })}
            </AlertDescription>
          </Alert>
        </div>
      )}
      <div className="divide-border divide-y">
        {invitations.map((inv) => (
          <div key={inv.token} className="flex items-center gap-3 px-4 py-3 sm:px-6">
            <div className="min-w-0 flex-1">
              <span className="text-sm">{t("fromGroup", { group: inv.groupName })}</span>{" "}
              <Badge variant="outline">{tg(`roles.${inv.role}`)}</Badge>
            </div>
            <Button size="sm" disabled={pending} onClick={() => accept(inv.token)}>
              <Check />
              {busy === inv.token ? t("accepting") : t("accept")}
            </Button>
          </div>
        ))}
      </div>
    </SectionCard>
  );
}

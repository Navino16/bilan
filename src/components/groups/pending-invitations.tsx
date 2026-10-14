"use client";

import { useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { Check, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ConfirmDialog } from "@/components/shell/confirm-dialog";
import { SectionCard } from "@/components/shell/section-card";
import {
  acceptInvitationAction,
  declineInvitationAction,
} from "@/server/transport/actions/invitations";

export type PendingForUser = { token: string; groupName: string; role: string };

export function PendingInvitations({ invitations }: { invitations: PendingForUser[] }) {
  const t = useTranslations("invitations");
  const tg = useTranslations("groups");
  const locale = useLocale();
  const router = useRouter();
  const [error, setError] = useState<{ code: string; hint?: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [declining, setDeclining] = useState<PendingForUser | null>(null);
  const [declineError, setDeclineError] = useState<{ code: string; hint?: string } | null>(null);

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

  function decline() {
    if (!declining) return;
    const fd = new FormData();
    fd.set("token", declining.token);
    setDeclineError(null);
    startTransition(async () => {
      const result = await declineInvitationAction(null, fd);
      // Already gone (revoked, renewed away or accepted elsewhere): nothing left to decline.
      const gone = result?.ok === false && ["NOT_FOUND", "ALREADY_USED"].includes(result.error);
      if (!result?.ok && !gone) {
        return setDeclineError(
          result ? { code: result.error, hint: result.hint } : { code: "FAILED" },
        );
      }
      setError(null);
      setDeclining(null);
      router.refresh();
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
          <div
            key={inv.token}
            data-slot="pending-invitation"
            className="flex flex-wrap items-center gap-3 px-4 py-3 sm:px-6"
          >
            <div className="min-w-40 flex-1">
              <span className="text-sm">{t("fromGroup", { group: inv.groupName })}</span>{" "}
              <Badge variant="outline">{tg(`roles.${inv.role}`)}</Badge>
            </div>
            <div className="flex shrink-0 gap-2">
              <Button
                size="sm"
                variant="ghost"
                disabled={pending}
                onClick={() => {
                  setDeclineError(null);
                  setDeclining(inv);
                }}
              >
                <X />
                {t("decline")}
              </Button>
              <Button size="sm" disabled={pending} onClick={() => accept(inv.token)}>
                <Check />
                {busy === inv.token ? t("accepting") : t("accept")}
              </Button>
            </div>
          </div>
        ))}
      </div>
      <ConfirmDialog
        open={declining !== null}
        onOpenChange={(open) => !open && setDeclining(null)}
        title={t("declineConfirm")}
        description={declining ? t("fromGroup", { group: declining.groupName }) : undefined}
        confirmLabel={t("decline")}
        onConfirm={decline}
        pending={pending}
        error={
          declineError
            ? t(`error.${declineError.code}`, { email: declineError.hint ?? "" })
            : undefined
        }
      />
    </SectionCard>
  );
}

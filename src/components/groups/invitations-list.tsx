"use client";

import { useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/shell/confirm-dialog";
import { CopyLinkButton } from "@/components/shell/copy-link-button";
import { LocalDateTime } from "@/components/shell/local-date-time";
import { revokeInvitationAction } from "@/server/transport/actions/invitations";

export type PendingInvitation = {
  id: string;
  email: string;
  role: string;
  code: string;
  token: string;
  expiresAt: string; // ISO
};

function RevokeButton({ id, email }: { id: string; email: string }) {
  const t = useTranslations("invitations");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState(false);
  const [pending, startTransition] = useTransition();

  function revoke() {
    const fd = new FormData();
    fd.set("id", id);
    setError(false);
    startTransition(async () => {
      const res = await revokeInvitationAction(null, fd);
      if (!res?.ok) return setError(true);
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label={t("revoke")}
        onClick={() => {
          setError(false);
          setOpen(true);
        }}
      >
        <X />
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={t("revokeConfirm")}
        description={email}
        confirmLabel={t("revoke")}
        onConfirm={revoke}
        pending={pending}
        error={error ? t("revokeFailed") : undefined}
      />
    </>
  );
}

export function InvitationsList({ invitations }: { invitations: PendingInvitation[] }) {
  const t = useTranslations("invitations");
  const tg = useTranslations("groups");
  const locale = useLocale();

  if (invitations.length === 0) {
    return <p className="text-muted-foreground text-sm">{t("noPending")}</p>;
  }

  return (
    <div className="border-border divide-border divide-y rounded-lg border">
      {invitations.map((inv) => (
        <div key={inv.id} className="flex items-center gap-3 px-4 py-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="truncate text-sm font-medium">{inv.email}</span>
              <Badge variant="outline">{tg(`roles.${inv.role}`)}</Badge>
            </div>
            <div className="text-muted-foreground text-xs">
              {t("code")}: <span className="font-mono">{inv.code}</span> ·{" "}
              {t.rich("expiresAt", { date: () => <LocalDateTime value={inv.expiresAt} /> })}
            </div>
          </div>
          <CopyLinkButton
            path={`/${locale}/groups/join/${inv.token}`}
            label={t("copyLink")}
            copiedLabel={t("linkCopied")}
          />
          <RevokeButton id={inv.id} email={inv.email} />
        </div>
      ))}
    </div>
  );
}

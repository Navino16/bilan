"use client";

import { useActionState, useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { Check, Link2, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  revokeInvitationAction,
  type InvitationActionState,
} from "@/server/transport/actions/invitations";

export type PendingInvitation = {
  id: string;
  email: string;
  role: string;
  code: string;
  token: string;
  expiresAt: string; // ISO
};

function CopyLinkButton({ token }: { token: string }) {
  const t = useTranslations("invitations");
  const locale = useLocale();
  const [copied, setCopied] = useState(false);

  async function copy() {
    await navigator.clipboard.writeText(`${window.location.origin}/${locale}/groups/join/${token}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      onClick={copy}
      aria-label={copied ? t("linkCopied") : t("copyLink")}
      title={copied ? t("linkCopied") : t("copyLink")}
    >
      {copied ? <Check /> : <Link2 />}
    </Button>
  );
}

function RevokeButton({ id }: { id: string }) {
  const t = useTranslations("invitations");
  const router = useRouter();
  const initial: InvitationActionState = null;
  const [state, action] = useActionState(revokeInvitationAction, initial);

  useEffect(() => {
    if (state?.ok) router.refresh();
  }, [state, router]);

  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (!window.confirm(t("revokeConfirm"))) e.preventDefault();
      }}
    >
      <input type="hidden" name="id" value={id} />
      <Button type="submit" variant="ghost" size="icon-sm" aria-label={t("revoke")}>
        <X />
      </Button>
    </form>
  );
}

export function InvitationsList({ invitations }: { invitations: PendingInvitation[] }) {
  const t = useTranslations("invitations");
  const tg = useTranslations("groups");
  const locale = useLocale();
  const fmtDate = (iso: string) => new Date(iso).toLocaleDateString(locale);

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
              {t("expiresAt", { date: fmtDate(inv.expiresAt) })}
            </div>
          </div>
          <CopyLinkButton token={inv.token} />
          <RevokeButton id={inv.id} />
        </div>
      ))}
    </div>
  );
}

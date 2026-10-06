"use client";

import { useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { LogOut, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SectionCard } from "@/components/shell/section-card";
import type { GroupRole } from "@/lib/validation/group";
import { deleteGroupAction, leaveGroupAction } from "@/server/transport/actions/groups";

export function GroupDangerZone({
  groupId,
  viewerRole,
  isLastOwner,
}: {
  groupId: string;
  viewerRole: GroupRole;
  isLastOwner: boolean;
}) {
  const t = useTranslations("groups");
  const locale = useLocale();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function run(
    confirm: string,
    action: (fd: FormData) => Promise<{ ok: boolean; error?: string } | null>,
  ) {
    if (!window.confirm(confirm)) return;
    setError(null);
    const fd = new FormData();
    fd.set("id", groupId);
    startTransition(async () => {
      const result = await action(fd);
      if (result?.ok) router.push(`/${locale}/groups`);
      else setError(result?.error ?? "FAILED");
    });
  }

  return (
    <SectionCard
      className="border-destructive/40"
      overline={t("dangerZone")}
      title={
        isLastOwner ? t("delete") : viewerRole === "OWNER" ? t("dangerTitleOwner") : t("leaveTitle")
      }
      hint={viewerRole === "OWNER" ? t("deleteHint") : t("leaveHint")}
    >
      <div className="flex flex-wrap gap-2">
        {/* The last owner can't leave (the service blocks it): deleting is their only exit. */}
        {!isLastOwner && (
          <Button
            variant="outline"
            disabled={pending}
            onClick={() => run(t("leaveConfirm"), (fd) => leaveGroupAction(null, fd))}
          >
            <LogOut />
            {t("leave")}
          </Button>
        )}
        {viewerRole === "OWNER" && (
          <Button
            variant="destructive"
            disabled={pending}
            onClick={() => run(t("deleteConfirm"), (fd) => deleteGroupAction(null, fd))}
          >
            <Trash2 />
            {t("delete")}
          </Button>
        )}
      </div>
      {error && <p className="text-destructive mt-3 text-sm">{t(`error.${error}`)}</p>}
    </SectionCard>
  );
}

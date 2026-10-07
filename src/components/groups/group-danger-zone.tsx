"use client";

import { useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { LogOut, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SectionCard } from "@/components/shell/section-card";
import { ConfirmDialog } from "@/components/shell/confirm-dialog";
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
  const [kind, setKind] = useState<"leave" | "delete">("leave");
  const [confirmOpen, setConfirmOpen] = useState(false);

  function ask(next: "leave" | "delete") {
    setError(null);
    setKind(next);
    setConfirmOpen(true);
  }

  function run() {
    const action = kind === "delete" ? deleteGroupAction : leaveGroupAction;
    setError(null);
    const fd = new FormData();
    fd.set("id", groupId);
    startTransition(async () => {
      const result = await action(null, fd);
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
          <Button variant="outline" disabled={pending} onClick={() => ask("leave")}>
            <LogOut />
            {t("leave")}
          </Button>
        )}
        {viewerRole === "OWNER" && (
          <Button variant="destructive" disabled={pending} onClick={() => ask("delete")}>
            <Trash2 />
            {t("delete")}
          </Button>
        )}
      </div>
      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={kind === "delete" ? t("delete") : t("leaveTitle")}
        description={kind === "delete" ? t("deleteConfirm") : t("leaveConfirm")}
        confirmLabel={kind === "delete" ? t("delete") : t("leave")}
        onConfirm={run}
        pending={pending}
        error={error ? t(`error.${error}`) : undefined}
      />
    </SectionCard>
  );
}

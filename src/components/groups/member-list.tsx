"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { UserMinus } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { GROUP_ROLES, type GroupRole } from "@/lib/validation/group";
import { changeMemberRoleAction, removeMemberAction } from "@/server/transport/actions/groups";
import { NativeSelect } from "@/components/ui/native-select";
import { ConfirmDialog } from "@/components/shell/confirm-dialog";

type Member = { userId: string; role: GroupRole; name: string | null; email: string };

const RANK: Record<GroupRole, number> = { OWNER: 3, ADMIN: 2, MEMBER: 1 };

export function MemberList({
  groupId,
  members,
  viewerId,
  viewerRole,
}: {
  groupId: string;
  members: Member[];
  viewerId: string;
  viewerRole: GroupRole;
}) {
  const t = useTranslations("groups");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [removing, setRemoving] = useState<Member | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const canManageRoles = viewerRole === "OWNER";
  const canRemove = RANK[viewerRole] >= RANK.ADMIN;

  function run(action: () => Promise<{ ok: boolean; error?: string } | null>) {
    startTransition(async () => {
      const result = await action();
      if (result?.ok) {
        setError(null);
        setConfirmOpen(false);
        router.refresh();
      } else {
        setError(result && "error" in result ? (result.error ?? "FAILED") : "FAILED");
      }
    });
  }

  function changeRole(userId: string, role: string) {
    const fd = new FormData();
    fd.set("id", groupId);
    fd.set("userId", userId);
    fd.set("role", role);
    run(() => changeMemberRoleAction(null, fd));
  }

  function remove(userId: string) {
    const fd = new FormData();
    fd.set("id", groupId);
    fd.set("userId", userId);
    run(() => removeMemberAction(null, fd));
  }

  return (
    <div className="space-y-4">
      <div className="border-border divide-border divide-y rounded-lg border">
        {members.map((m) => {
          const isSelf = m.userId === viewerId;
          const display = m.name?.trim() || m.email;
          return (
            <div key={m.userId} className="flex items-center gap-3 px-4 py-3">
              <Avatar className="size-8">
                <AvatarFallback className="bg-accent text-accent-foreground text-xs">
                  {display.slice(0, 2).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium">{display}</span>
                  {isSelf && <Badge variant="secondary">{t("you")}</Badge>}
                </div>
                <div className="text-muted-foreground truncate text-xs">{m.email}</div>
              </div>
              {canManageRoles ? (
                <NativeSelect
                  aria-label={t("role")}
                  value={m.role}
                  disabled={pending}
                  onChange={(e) => changeRole(m.userId, e.target.value)}
                  size="sm"
                >
                  {GROUP_ROLES.map((r) => (
                    <option key={r} value={r}>
                      {t(`roles.${r}`)}
                    </option>
                  ))}
                </NativeSelect>
              ) : (
                <Badge variant="outline">{t(`roles.${m.role}`)}</Badge>
              )}
              {canRemove && !isSelf && (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t("remove")}
                  disabled={pending}
                  onClick={() => {
                    setError(null);
                    setRemoving(m);
                    setConfirmOpen(true);
                  }}
                >
                  <UserMinus />
                </Button>
              )}
            </div>
          );
        })}
      </div>

      {error && !confirmOpen && <p className="text-destructive text-sm">{t(`error.${error}`)}</p>}
      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={t("removeTitle", { name: removing?.name?.trim() || removing?.email || "" })}
        description={t("removeConfirm")}
        confirmLabel={t("remove")}
        onConfirm={() => removing && remove(removing.userId)}
        pending={pending}
        error={error && confirmOpen ? t(`error.${error}`) : undefined}
      />
    </div>
  );
}

"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { NativeSelect } from "@/components/ui/native-select";
import { ConfirmDialog } from "@/components/shell/confirm-dialog";
import { setUserRoleAction } from "@/server/transport/actions/admin";
import { INSTANCE_ROLES, isInstanceRole, type InstanceRole } from "@/lib/instance-roles";

export function RoleSelect({
  userId,
  role,
  userLabel,
}: {
  userId: string;
  role: InstanceRole;
  userLabel: string;
}) {
  const t = useTranslations("admin");
  const router = useRouter();
  const [next, setNext] = useState<InstanceRole | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function confirm() {
    if (!next) return;
    const fd = new FormData();
    fd.set("userId", userId);
    fd.set("role", next);
    setError(null);
    startTransition(async () => {
      const res = await setUserRoleAction(null, fd);
      if (!res?.ok) return setError(res?.error ?? "FAILED");
      // Commits with the refreshed `role` prop, so the select never shows the old role.
      startTransition(() => {
        setNext(null);
        router.refresh();
      });
    });
  }

  return (
    <div className="flex flex-col items-end gap-1 md:items-start">
      <NativeSelect
        size="sm"
        value={next ?? role}
        disabled={pending}
        aria-label={t("users.roleFor", { user: userLabel })}
        onChange={(e) => {
          if (!isInstanceRole(e.target.value) || e.target.value === role) return;
          setError(null);
          setNext(e.target.value);
        }}
      >
        {INSTANCE_ROLES.map((r) => (
          <option key={r} value={r}>
            {t(`roles.${r}`)}
          </option>
        ))}
      </NativeSelect>
      <ConfirmDialog
        open={next !== null}
        onOpenChange={(open) => !open && setNext(null)}
        title={t("users.roleConfirmTitle", { user: userLabel })}
        description={
          next &&
          t("users.roleConfirmBody", {
            from: t(`roles.${role}`),
            to: t(`roles.${next}`),
          })
        }
        confirmLabel={t("users.roleConfirm")}
        onConfirm={confirm}
        pending={pending}
        destructive={next === "SUPER_ADMIN"}
        error={error ? t(`users.roleError.${error}`) : undefined}
      >
        {next === "SUPER_ADMIN" && (
          <p className="text-muted-foreground text-sm">{t("users.roleSuperAdminWarning")}</p>
        )}
      </ConfirmDialog>
    </div>
  );
}

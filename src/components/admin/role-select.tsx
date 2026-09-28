"use client";

import { useActionState, useEffect, useRef } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { NativeSelect } from "@/components/ui/native-select";
import { setUserRoleAction } from "@/server/transport/actions/admin";
import { INSTANCE_ROLES, type InstanceRole } from "@/lib/instance-roles";

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
  const formRef = useRef<HTMLFormElement>(null);
  const [state, action, pending] = useActionState(setUserRoleAction, null);

  useEffect(() => {
    if (state?.ok) router.refresh();
    else if (state) formRef.current?.reset();
  }, [state, router]);

  return (
    <form ref={formRef} action={action} className="flex flex-col items-end gap-1 md:items-start">
      <input type="hidden" name="userId" value={userId} />
      <NativeSelect
        key={role}
        name="role"
        size="sm"
        defaultValue={role}
        disabled={pending}
        aria-label={t("users.roleFor", { user: userLabel })}
        onChange={() => formRef.current?.requestSubmit()}
      >
        {INSTANCE_ROLES.map((r) => (
          <option key={r} value={r}>
            {t(`roles.${r}`)}
          </option>
        ))}
      </NativeSelect>
      {state && !state.ok && (
        <p role="alert" className="text-destructive text-xs">
          {t(`users.roleError.${state.error}`)}
        </p>
      )}
    </form>
  );
}

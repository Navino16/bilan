"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/shell/confirm-dialog";
import {
  deleteAuthProviderAction,
  type DeleteProviderState,
} from "@/server/transport/actions/settings";
import type { AuthProviderImpact } from "@/server/services/settings/auth-providers";

type Failure = Exclude<DeleteProviderState, { ok: true }>;

export function AuthProviderDelete({
  providerKey,
  name,
  impact,
  enabled,
  credentialsEnabled,
}: {
  providerKey: string;
  name: string;
  impact: AuthProviderImpact;
  enabled: boolean;
  credentialsEnabled: boolean;
}) {
  const t = useTranslations("admin.authProviders");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<Failure | null>(null);
  const [pending, startTransition] = useTransition();

  function remove() {
    setError(null);
    startTransition(async () => {
      const res = await deleteAuthProviderAction(providerKey);
      if (!res.ok) return setError(res);
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        onClick={() => {
          setError(null);
          setOpen(true);
        }}
      >
        <Trash2 />
        {t("delete")}
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={t("deleteTitle", { name })}
        description={t("deleteBody")}
        confirmLabel={pending ? t("deleting") : t("delete")}
        onConfirm={remove}
        pending={pending}
        confirmDisabled={impact.lockedOut > 0}
        error={error ? t(`error.${error.error}`, { count: error.count ?? 0 }) : undefined}
      >
        {impact.linkedAccounts > 0 && (
          <p className="text-muted-foreground text-sm">
            {t("deleteLinked", { count: impact.linkedAccounts })}
          </p>
        )}
        {impact.lockedOut > 0 && (
          <p className="text-destructive text-sm">
            {t(enabled && !credentialsEnabled ? "deleteLockoutNoPassword" : "deleteLockout", {
              count: impact.lockedOut,
            })}
          </p>
        )}
      </ConfirmDialog>
    </>
  );
}

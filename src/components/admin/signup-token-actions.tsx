"use client";

import { useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { Ban, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/shell/confirm-dialog";
import { CopyLinkButton } from "@/components/shell/copy-link-button";
import { deleteSignupTokenAction, revokeSignupTokenAction } from "@/server/transport/actions/admin";

export function SignupTokenActions({
  id,
  token,
  active,
}: {
  id: string;
  token: string;
  active: boolean;
}) {
  const t = useTranslations("admin.signupTokens");
  const locale = useLocale();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function confirm() {
    const fd = new FormData();
    fd.set("id", id);
    setError(null);
    startTransition(async () => {
      const res = active
        ? await revokeSignupTokenAction(null, fd)
        : await deleteSignupTokenAction(null, fd);
      if (!res?.ok) return setError(res?.error ?? "FAILED");
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <div className="flex items-center justify-end gap-0.5">
      {active && (
        <CopyLinkButton
          path={`/${locale}/register?adminToken=${encodeURIComponent(token)}`}
          label={t("copyLink")}
          copiedLabel={t("linkCopied")}
        />
      )}
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label={active ? t("revoke") : t("delete")}
        title={active ? t("revoke") : t("delete")}
        onClick={() => {
          setError(null);
          setOpen(true);
        }}
      >
        {active ? <Ban /> : <Trash2 />}
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={active ? t("revokeTitle") : t("deleteTitle")}
        description={active ? t("revokeBody") : t("deleteBody")}
        confirmLabel={active ? t("revoke") : t("delete")}
        onConfirm={confirm}
        pending={pending}
        error={error ? t(`error.${error}`) : undefined}
      />
    </div>
  );
}

"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { Unplug } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/shell/confirm-dialog";
import { disconnectBankAction } from "@/server/transport/actions/bank-sync";

export function BankDisconnectButton({
  connectionId,
  aspspName,
}: {
  connectionId: string;
  aspspName: string;
}) {
  const t = useTranslations("accounts.bankSync");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function disconnect() {
    setError(null);
    startTransition(async () => {
      let res: Awaited<ReturnType<typeof disconnectBankAction>>;
      try {
        res = await disconnectBankAction(connectionId);
      } catch {
        res = { ok: false, error: "FAILED" };
      }
      if (!res.ok) return setError(res.error);
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => {
          setError(null);
          setOpen(true);
        }}
      >
        <Unplug />
        {t("disconnect.submit")}
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={t("disconnect.title", { bank: aspspName })}
        description={t("disconnect.body")}
        confirmLabel={pending ? t("disconnect.submitting") : t("disconnect.submit")}
        onConfirm={disconnect}
        pending={pending}
        error={
          error
            ? t.has(`error.${error}`)
              ? t(`error.${error as "FAILED"}`)
              : t("error.FAILED")
            : undefined
        }
      />
    </>
  );
}

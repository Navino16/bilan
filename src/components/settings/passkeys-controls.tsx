"use client";

import { useState, useTransition } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { KeyRound, Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { overline } from "@/components/transactions/bits";
import { authClient } from "@/lib/auth-client";
import { describeUserAgent } from "@/lib/user-agent";
import type { PasskeyView } from "@/server/services/users/passkeys";

const NAME_MAX = 64;

type ErrorKey = "NOT_FRESH" | "ALREADY_REGISTERED" | "ADD_FAILED" | "FAILED";

function addErrorKey(code: string | undefined): ErrorKey {
  if (code === "SESSION_NOT_FRESH") return "NOT_FRESH";
  if (code === "ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED") return "ALREADY_REGISTERED";
  return "ADD_FAILED";
}

function PasskeyRow({
  passkey,
  disabled,
  onRename,
  onDelete,
}: {
  passkey: PasskeyView;
  disabled: boolean;
  onRename: (name: string) => Promise<boolean>;
  onDelete: () => void;
}) {
  const t = useTranslations("settings.security.passkeysCard");
  const format = useFormatter();
  const name = passkey.name || t("unnamed");
  const [draft, setDraft] = useState<string | null>(null);

  if (draft !== null) {
    return (
      <li className="border-t py-3">
        <form
          className="flex items-center gap-2"
          onSubmit={async (e) => {
            e.preventDefault();
            if (await onRename(draft.trim())) setDraft(null);
          }}
        >
          <Input
            aria-label={t("nameLabel")}
            value={draft}
            maxLength={NAME_MAX}
            autoFocus
            onChange={(e) => setDraft(e.target.value)}
          />
          <Button type="submit" disabled={disabled || !draft.trim()}>
            {t("save")}
          </Button>
          <Button type="button" variant="ghost" onClick={() => setDraft(null)}>
            {t("cancel")}
          </Button>
        </form>
      </li>
    );
  }

  return (
    <li className="flex items-center gap-3 border-t py-3" data-passkey-id={passkey.id}>
      <KeyRound className="text-muted-foreground size-[18px] shrink-0" aria-hidden />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{name}</div>
        <div className="text-muted-foreground text-xs">
          {t("added", { date: format.dateTime(passkey.createdAt, { dateStyle: "medium" }) })}
          {" · "}
          {passkey.synced ? t("synced") : t("deviceBound")}
        </div>
      </div>
      <Button
        variant="ghost"
        size="icon-sm"
        disabled={disabled}
        aria-label={t("rename", { name })}
        onClick={() => setDraft(passkey.name ?? "")}
      >
        <Pencil />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        className="text-destructive hover:text-destructive"
        disabled={disabled}
        aria-label={t("delete", { name })}
        onClick={onDelete}
      >
        <Trash2 />
      </Button>
    </li>
  );
}

export function PasskeysControls({ passkeys }: { passkeys: PasskeyView[] }) {
  const t = useTranslations("settings.security.passkeysCard");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<ErrorKey | null>(null);
  const [deleting, setDeleting] = useState<PasskeyView | null>(null);

  function add() {
    setError(null);
    startTransition(async () => {
      const { browser, os } = describeUserAgent(navigator.userAgent);
      const name = [browser, os].filter(Boolean).join(" · ") || t("defaultName");
      const res = await authClient.passkey.addPasskey({ name });
      if (res?.error)
        return setError(addErrorKey("code" in res.error ? res.error.code : undefined));
      router.refresh();
    });
  }

  async function rename(id: string, name: string): Promise<boolean> {
    setError(null);
    const res = await authClient.passkey.updatePasskey({ id, name });
    if (res.error) {
      setError("FAILED");
      return false;
    }
    router.refresh();
    return true;
  }

  function confirmDelete(id: string) {
    setError(null);
    startTransition(async () => {
      const res = await authClient.passkey.deletePasskey({ id });
      setDeleting(null);
      if (res.error) setError("FAILED");
      router.refresh();
    });
  }

  return (
    <div className="space-y-2" data-slot="passkeys-controls">
      <div className="flex min-h-8 items-center justify-between gap-3">
        <span className={overline}>{t("count", { count: passkeys.length })}</span>
        <Button variant="outline" disabled={pending} onClick={add}>
          <Plus />
          {t("add")}
        </Button>
      </div>
      {passkeys.length === 0 ? (
        <p className="text-muted-foreground border-t pt-3 text-sm">{t("none")}</p>
      ) : (
        <ul>
          {passkeys.map((pk) => (
            <PasskeyRow
              key={pk.id}
              passkey={pk}
              disabled={pending}
              onRename={(name) => rename(pk.id, name)}
              onDelete={() => setDeleting(pk)}
            />
          ))}
        </ul>
      )}
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{t(`error.${error}`)}</AlertDescription>
        </Alert>
      )}
      {deleting && (
        <Dialog open onOpenChange={(open) => !open && !pending && setDeleting(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t("deleteTitle")}</DialogTitle>
              <DialogDescription>
                {t("deleteBody", { name: deleting.name || t("unnamed") })}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <DialogClose render={<Button variant="ghost" type="button" disabled={pending} />}>
                {t("cancel")}
              </DialogClose>
              <Button
                variant="destructive"
                disabled={pending}
                onClick={() => confirmDelete(deleting.id)}
              >
                {t("deleteConfirm")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

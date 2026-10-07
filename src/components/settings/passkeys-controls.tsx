"use client";

import { useRef, useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
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
import { LocalDateTime } from "@/components/shell/local-date-time";
import { authClient } from "@/lib/auth-client";
import { describeUserAgent } from "@/lib/user-agent";
import { uniqueName } from "@/lib/unique-name";
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
  onRename: (name: string, done: () => void) => void;
  onDelete: () => void;
}) {
  const t = useTranslations("settings.security.passkeysCard");
  const name = passkey.name || t("unnamed");
  const [draft, setDraft] = useState<string | null>(null);
  const refocusRename = useRef(false);

  function cancel() {
    refocusRename.current = true;
    setDraft(null);
  }

  if (draft !== null) {
    return (
      <li className="border-t py-3">
        <form
          className="flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            onRename(draft.trim(), () => setDraft(null));
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              e.stopPropagation();
              cancel();
            }
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
          <Button type="button" variant="ghost" onClick={cancel}>
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
          {t.rich("added", { date: () => <LocalDateTime value={passkey.createdAt} /> })}
          {" · "}
          {passkey.synced ? t("synced") : t("deviceBound")}
        </div>
      </div>
      <Button
        variant="ghost"
        size="icon-sm"
        disabled={disabled}
        aria-label={t("rename", { name })}
        ref={(el) => {
          if (el && refocusRename.current) {
            refocusRename.current = false;
            el.focus();
          }
        }}
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
  const locale = useLocale();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<ErrorKey | null>(null);
  const [deleting, setDeleting] = useState<PasskeyView | null>(null);

  function add() {
    setError(null);
    startTransition(async () => {
      const { browser, os } = describeUserAgent(navigator.userAgent);
      const name = uniqueName(
        [browser, os].filter(Boolean).join(" · ") || t("defaultName"),
        passkeys.map((pk) => pk.name),
      );
      // Named afterwards: addPasskey's name would also become the WebAuthn userName
      // shown in the device's password manager, where the email is expected.
      const res = await authClient.passkey.addPasskey();
      if (res?.error)
        return setError(addErrorKey("code" in res.error ? res.error.code : undefined));
      if (res?.data) await authClient.passkey.updatePasskey({ id: res.data.id, name });
      startTransition(() => router.refresh());
    });
  }

  function rename(id: string, name: string, done: () => void) {
    setError(null);
    startTransition(async () => {
      const res = await authClient.passkey.updatePasskey({ id, name });
      if (res.error) return setError("FAILED");
      startTransition(() => {
        done();
        router.refresh();
      });
    });
  }

  function signInAgain() {
    startTransition(async () => {
      await authClient.signOut();
      router.push(`/${locale}/login`);
    });
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
              onRename={(name, done) => rename(pk.id, name, done)}
              onDelete={() => setDeleting(pk)}
            />
          ))}
        </ul>
      )}
      {error && (
        <Alert variant="destructive">
          <AlertDescription>
            {t(`error.${error}`)}
            {error === "NOT_FRESH" && (
              <Button variant="link" className="h-auto p-0" onClick={signInAgain}>
                {t("signInAgain")}
              </Button>
            )}
          </AlertDescription>
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

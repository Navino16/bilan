"use client";

import { useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { Link2, Unlink } from "lucide-react";
import { Button } from "@/components/ui/button";
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
import { loginRedirectPath } from "@/lib/callback-url";
import type { LinkError } from "@/lib/sso-errors";
import { linkIdentityAction, unlinkIdentityAction } from "@/server/transport/actions/identities";
import type { IdentitiesView, IdentityView } from "@/server/services/users/identities";

const ERROR_KEYS = ["NOT_FRESH", "LOCKOUT", "ALREADY_LINKED", "UNAVAILABLE", "BAD_ORIGIN"] as const;
type ErrorKey = (typeof ERROR_KEYS)[number] | "FAILED";

export type IdentityNotice = { linked: string } | { linkError: LinkError };

function errorKey(code: string): ErrorKey {
  return ERROR_KEYS.find((k) => k === code) ?? "FAILED";
}

function IdentityRow({
  identity,
  disabled,
  onUnlink,
}: {
  identity: IdentityView;
  disabled: boolean;
  onUnlink: () => void;
}) {
  const t = useTranslations("settings.security.identitiesCard");
  return (
    <li className="flex items-center gap-3 border-t py-3" data-identity={identity.providerId}>
      <Link2 className="text-muted-foreground size-[18px] shrink-0" aria-hidden />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{identity.displayName}</div>
        <div className="text-muted-foreground text-xs">
          {t.rich("linkedAt", { date: () => <LocalDateTime value={identity.linkedAt} /> })}
          {!identity.providerEnabled && ` · ${t("providerDisabled")}`}
        </div>
        {!identity.canUnlink && (
          <p className="text-muted-foreground mt-1 text-xs">{t("onlyMethod")}</p>
        )}
      </div>
      <Button
        variant="ghost"
        size="icon-sm"
        className="text-destructive hover:text-destructive"
        disabled={disabled || !identity.canUnlink}
        aria-label={t("unlink", { name: identity.displayName })}
        onClick={onUnlink}
      >
        <Unlink />
      </Button>
    </li>
  );
}

export function IdentitiesControls({
  identities,
  notice,
}: {
  identities: IdentitiesView;
  notice?: IdentityNotice;
}) {
  const t = useTranslations("settings.security.identitiesCard");
  const router = useRouter();
  const locale = useLocale();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<ErrorKey | null>(null);
  const [unlinking, setUnlinking] = useState<IdentityView | null>(null);
  const [showNotice, setShowNotice] = useState(true);
  const { linked, linkable } = identities;

  function link(providerId: string) {
    setError(null);
    setShowNotice(false);
    startTransition(async () => {
      const res = await linkIdentityAction(providerId, locale);
      if (!res.ok) return setError(errorKey(res.error));
      window.location.assign(res.url);
    });
  }

  function confirmUnlink(id: string) {
    setError(null);
    setShowNotice(false);
    startTransition(async () => {
      const res = await unlinkIdentityAction(id);
      setUnlinking(null);
      if (!res.ok) setError(errorKey(res.error));
      router.refresh();
    });
  }

  function signInAgain() {
    startTransition(async () => {
      await authClient.signOut();
      router.push(loginRedirectPath(locale, `/${locale}/settings/security`));
    });
  }

  return (
    <div className="space-y-2" data-slot="identities-controls">
      {notice && showNotice && (
        <Alert variant={"linked" in notice ? "default" : "destructive"}>
          <AlertDescription>
            {"linked" in notice
              ? t("linkedNotice", { name: notice.linked })
              : t(`linkError.${notice.linkError}`)}
          </AlertDescription>
        </Alert>
      )}
      <div className="flex min-h-8 items-center">
        <span className={overline}>{t("count", { count: linked.length })}</span>
      </div>
      {linked.length === 0 ? (
        <p className="text-muted-foreground border-t pt-3 text-sm">{t("none")}</p>
      ) : (
        <ul>
          {linked.map((identity) => (
            <IdentityRow
              key={identity.id}
              identity={identity}
              disabled={pending}
              onUnlink={() => setUnlinking(identity)}
            />
          ))}
        </ul>
      )}
      {linkable.length > 0 && (
        <div className="flex flex-wrap gap-2 border-t pt-3">
          {linkable.map((p) => (
            <Button
              key={p.providerId}
              variant="outline"
              disabled={pending}
              onClick={() => link(p.providerId)}
            >
              <Link2 />
              {t("link", { name: p.displayName })}
            </Button>
          ))}
        </div>
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
      {unlinking && (
        <Dialog open onOpenChange={(open) => !open && !pending && setUnlinking(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t("unlinkTitle")}</DialogTitle>
              <DialogDescription>
                {t("unlinkBody", { name: unlinking.displayName })}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <DialogClose render={<Button variant="ghost" type="button" disabled={pending} />}>
                {t("cancel")}
              </DialogClose>
              <Button
                variant="destructive"
                disabled={pending}
                onClick={() => confirmUnlink(unlinking.id)}
              >
                {t("unlinkConfirm")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

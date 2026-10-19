"use client";

import { useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { usePathname, useRouter } from "next/navigation";
import { Eye, LogIn } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { useIsMobile } from "@/hooks/use-is-mobile";
import { authClient } from "@/lib/auth-client";
import { loginRedirectPath } from "@/lib/callback-url";
import type { IbanReauthMethod } from "@/server/services/accounts/iban-reveal";
import { revealAccountIbanAction } from "@/server/transport/actions/accounts";

type Failure = {
  error: "BAD_PASSWORD" | "RATE_LIMITED" | "NOT_FOUND" | "FAILED";
  retryAfter?: number;
};

// Mount it only while open: the typed password goes away with it.
export function IbanReauthDialog({
  accountId,
  method,
  onClose,
  onRevealed,
}: {
  accountId: string;
  method: IbanReauthMethod;
  onClose: () => void;
  onRevealed: (iban: string) => void;
}) {
  const t = useTranslations("accounts.ibanReauth");
  const locale = useLocale();
  const pathname = usePathname();
  const router = useRouter();
  const liveMobile = useIsMobile();
  const [isMobile] = useState(liveMobile);
  const [password, setPassword] = useState("");
  const [failure, setFailure] = useState<Failure | null>(null);
  const [pending, startTransition] = useTransition();

  function confirm(e: React.FormEvent) {
    e.preventDefault();
    setFailure(null);
    startTransition(async () => {
      try {
        const res = await revealAccountIbanAction(accountId, password);
        if (res.ok) return onRevealed(res.iban);
        if (res.error === "REAUTH_REQUIRED") return setFailure({ error: "FAILED" });
        setFailure(res.error === "RATE_LIMITED" ? res : { error: res.error });
      } catch {
        setFailure({ error: "FAILED" });
      }
    });
  }

  function signInAgain() {
    startTransition(async () => {
      await authClient.signOut();
      router.push(loginRedirectPath(locale, pathname));
    });
  }

  const errorText = !failure
    ? null
    : failure.error === "RATE_LIMITED" && failure.retryAfter
      ? t("error.rateLimitedFor", { minutes: Math.ceil(failure.retryAfter / 60) })
      : t(`error.${failure.error}`);

  const body = (
    <>
      <DialogHeader className="border-border shrink-0 border-b px-6 pt-5 pb-4 text-left">
        <DialogTitle className="font-display text-2xl">{t("title")}</DialogTitle>
        <DialogDescription>
          {t(method === "PASSWORD" ? "passwordBody" : "signInBody")}
        </DialogDescription>
      </DialogHeader>

      <form className="flex min-h-0 flex-1 flex-col" onSubmit={confirm} data-slot="iban-reauth">
        <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-6 py-5">
          {method === "PASSWORD" ? (
            <div className="space-y-2">
              <Label htmlFor="iban-reauth-password">{t("password")}</Label>
              <Input
                id="iban-reauth-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                autoFocus
                required
              />
            </div>
          ) : (
            <p className="text-muted-foreground text-sm">{t("signInHint")}</p>
          )}
          {errorText && (
            <Alert variant="destructive">
              <AlertDescription>{errorText}</AlertDescription>
            </Alert>
          )}
        </div>

        <DialogFooter className="bg-muted/40 border-border shrink-0 border-t px-6 py-3">
          <Button type="button" variant="ghost" onClick={onClose}>
            {t("cancel")}
          </Button>
          {method === "PASSWORD" ? (
            <Button type="submit" disabled={pending || !password}>
              <Eye />
              {pending ? t("checking") : t("confirm")}
            </Button>
          ) : (
            <Button type="button" disabled={pending} onClick={signInAgain}>
              <LogIn />
              {t("signInAgain")}
            </Button>
          )}
        </DialogFooter>
      </form>
    </>
  );

  const onOpenChange = (open: boolean) => !open && !pending && onClose();

  return isMobile ? (
    <Sheet open onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="flex max-h-[90dvh] flex-col gap-0 overflow-hidden rounded-t-2xl p-0"
      >
        {body}
      </SheetContent>
    </Sheet>
  ) : (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90dvh] flex-col gap-0 overflow-hidden p-0 sm:max-w-md">
        {body}
      </DialogContent>
    </Dialog>
  );
}

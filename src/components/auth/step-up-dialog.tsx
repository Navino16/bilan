"use client";

import { useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { usePathname, useRouter } from "next/navigation";
import { Check, LogIn } from "lucide-react";
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
import type { StepUpMethod } from "@/server/services/users/step-up";

export type StepUpFailure = { ok: false; error: string; retryAfter?: number };
export type StepUpPurpose = "iban" | "export";

const KNOWN_ERRORS = new Set(["BAD_PASSWORD", "RATE_LIMITED", "NOT_FOUND"]);

export function useStepUpErrorText() {
  const t = useTranslations("stepUp.error");
  return (failure: StepUpFailure | null) =>
    !failure
      ? null
      : failure.error === "RATE_LIMITED" && failure.retryAfter
        ? t("rateLimitedFor", { minutes: Math.ceil(failure.retryAfter / 60) })
        : t(KNOWN_ERRORS.has(failure.error) ? failure.error : "FAILED");
}

// Re-authentication before reading a secret (#257). Mount it only while open: the typed
// password goes away with it.
export function StepUpDialog({
  method,
  purpose,
  confirm,
  onConfirmed,
  onClose,
}: {
  method: StepUpMethod;
  purpose: StepUpPurpose;
  confirm: (password: string) => Promise<{ ok: true } | StepUpFailure>;
  onConfirmed: () => void;
  onClose: () => void;
}) {
  const t = useTranslations("stepUp");
  const errorText = useStepUpErrorText();
  const locale = useLocale();
  const pathname = usePathname();
  const router = useRouter();
  const liveMobile = useIsMobile();
  const [isMobile] = useState(liveMobile);
  const [password, setPassword] = useState("");
  const [failure, setFailure] = useState<StepUpFailure | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setFailure(null);
    startTransition(async () => {
      try {
        const res = await confirm(password);
        if (res.ok) return onConfirmed();
        setFailure(res);
      } catch {
        setFailure({ ok: false, error: "FAILED" });
      }
    });
  }

  function signInAgain() {
    setFailure(null);
    startTransition(async () => {
      try {
        const res = await authClient.signOut();
        if (res?.error) return setFailure({ ok: false, error: "FAILED" });
        router.push(loginRedirectPath(locale, pathname));
      } catch {
        setFailure({ ok: false, error: "FAILED" });
      }
    });
  }

  const message = errorText(failure);
  const body = (
    <>
      <DialogHeader className="border-border shrink-0 border-b px-6 pt-5 pb-4 text-left">
        <DialogTitle className="font-display text-2xl">{t("title")}</DialogTitle>
        <DialogDescription>
          {t(method === "PASSWORD" ? `passwordBody.${purpose}` : `signInBody.${purpose}`)}
        </DialogDescription>
      </DialogHeader>

      <form className="flex min-h-0 flex-1 flex-col" onSubmit={submit} data-slot="step-up">
        <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-6 py-5">
          {method === "PASSWORD" ? (
            <div className="space-y-2">
              <Label htmlFor="step-up-password">{t("password")}</Label>
              <Input
                id="step-up-password"
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
          {message && (
            <Alert variant="destructive">
              <AlertDescription>{message}</AlertDescription>
            </Alert>
          )}
        </div>

        <DialogFooter className="bg-muted/40 border-border shrink-0 border-t px-6 py-3">
          <Button type="button" variant="ghost" onClick={onClose}>
            {t("cancel")}
          </Button>
          {method === "PASSWORD" ? (
            <Button type="submit" disabled={pending || !password}>
              <Check />
              {pending ? t("checking") : t(`confirm.${purpose}`)}
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

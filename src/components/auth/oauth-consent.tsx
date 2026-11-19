"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { usePathname, useRouter } from "next/navigation";
import { Clock, Info, Lock } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { StepUpDialog, type StepUpFailure } from "@/components/auth/step-up-dialog";
import { overline } from "@/components/transactions/bits";
import { approveOAuthConsentAction, denyOAuthConsentAction } from "@/server/transport/actions/mcp";
import type { ConsentAccess, ConsentRequest } from "@/server/mcp/oauth-consent";
import type { StepUpMethod } from "@/server/services/users/step-up";

export type ConsentView =
  | { kind: "error"; code: string | null }
  | { kind: "instanceOff" | "expired"; email: string }
  | {
      kind: "consent" | "mcpDisabled" | "noScope";
      email: string;
      request: ConsentRequest;
      choices: ConsentAccess[];
    };

type Failure = "expired" | "error.FAILED";

const STEP_UP_ERRORS = new Set(["BAD_PASSWORD", "RATE_LIMITED", "REAUTH_REQUIRED"]);

export function OAuthConsent({ view, appName }: { view: ConsentView; appName: string }) {
  const t = useTranslations("auth.consent");
  return (
    <div className="space-y-6" data-slot="oauth-consent">
      <header className="space-y-1 text-center">
        <h1 className="font-display text-2xl text-balance">{t("title", { appName })}</h1>
        {"email" in view && (
          <p className="text-muted-foreground text-xs">
            {t.rich("signedInAs", {
              email: view.email,
              strong: (chunks) => <span className="text-foreground">{chunks}</span>,
            })}
          </p>
        )}
      </header>
      {view.kind === "error" ? (
        <Alert variant="destructive">
          <AlertDescription>
            <p>{t("failed")}</p>
            {view.code && <p className="font-mono text-xs">{t("code", { code: view.code })}</p>}
          </AlertDescription>
        </Alert>
      ) : "request" in view ? (
        <ClientRequest view={view} />
      ) : (
        <Note>{t(view.kind)}</Note>
      )}
    </div>
  );
}

function Note({ children }: { children: React.ReactNode }) {
  return (
    <Alert role="note">
      <Info />
      <AlertDescription className="text-card-foreground text-pretty">{children}</AlertDescription>
    </Alert>
  );
}

function ClientCard({ request, note }: { request: ConsentRequest; note: boolean }) {
  const t = useTranslations("auth.consent");
  return (
    <section className="bg-muted/50 space-y-3 rounded-lg border p-4">
      <div className="space-y-1">
        <div className={overline}>{t("client")}</div>
        <div className="text-lg leading-tight font-medium wrap-anywhere">
          {request.clientName ?? t("unnamed")}
        </div>
      </div>
      <div className="space-y-1">
        <div className={overline}>{t("redirect")}</div>
        <div className="flex items-center gap-1.5 font-mono text-base font-medium">
          <Lock className="text-muted-foreground size-4 shrink-0" aria-hidden />
          <span className="wrap-anywhere">{request.redirectHost}</span>
        </div>
      </div>
      {note && <p className="text-muted-foreground text-xs">{t("nameNote")}</p>}
    </section>
  );
}

function ClientRequest({ view }: { view: Extract<ConsentView, { request: ConsentRequest }> }) {
  const t = useTranslations("auth.consent");
  const locale = useLocale();
  const pathname = usePathname();
  const router = useRouter();
  const { request, choices } = view;
  const [access, setAccess] = useState<ConsentAccess | undefined>(choices[0]);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [reauth, setReauth] = useState<StepUpMethod | null>(null);
  const [pending, startTransition] = useTransition();
  const [leaving, setLeaving] = useState(false);
  const busy = pending || leaving;

  function leave(url: string) {
    setLeaving(true);
    // A navigation, not a form post: the CSP's form-action 'self' blocks the client's origin.
    window.location.assign(url);
  }

  // A switch turned off since the page loaded: the refreshed page says which one.
  function fail(error: string) {
    if (["MCP_DISABLED", "INSTANCE_DISABLED", "NO_SCOPE"].includes(error)) return router.refresh();
    setFailure(error === "EXPIRED" || error === "INVALID" ? "expired" : "error.FAILED");
  }

  function approve() {
    if (!access) return;
    setFailure(null);
    startTransition(async () => {
      try {
        const res = await approveOAuthConsentAction({ oauthQuery: request.oauthQuery, access });
        if (res.ok) return leave(res.url);
        if (res.error === "REAUTH_REQUIRED") return setReauth(res.method);
        if (res.error === "LOGIN_REQUIRED") return setReauth("SIGN_IN");
        fail(res.error);
      } catch {
        fail("FAILED");
      }
    });
  }

  async function approveWithPassword(password: string): Promise<{ ok: true } | StepUpFailure> {
    if (!access) return { ok: false, error: "FAILED" };
    const res = await approveOAuthConsentAction(
      { oauthQuery: request.oauthQuery, access },
      password,
    );
    if (res.ok) {
      leave(res.url);
      return { ok: true };
    }
    if (STEP_UP_ERRORS.has(res.error)) return res;
    fail(res.error);
    return { ok: true };
  }

  function deny() {
    setFailure(null);
    startTransition(async () => {
      try {
        const res = await denyOAuthConsentAction(request.oauthQuery);
        if (res.ok) return leave(res.url);
        fail(res.error);
      } catch {
        fail("FAILED");
      }
    });
  }

  const denyButton = (
    <Button
      type="button"
      variant="outline"
      size="lg"
      className="w-full"
      disabled={busy}
      onClick={deny}
    >
      {t("deny")}
    </Button>
  );

  if (view.kind !== "consent") {
    return (
      <>
        <ClientCard request={request} note={view.kind === "noScope"} />
        <Note>
          {view.kind === "noScope"
            ? t("noScope")
            : t.rich("mcpDisabled", {
                link: (chunks) => (
                  <Link
                    href={`/${locale}/settings/ai`}
                    className="text-foreground font-medium underline underline-offset-4"
                  >
                    {chunks}
                  </Link>
                ),
              })}
        </Note>
        {failure && <FailureAlert failure={failure} />}
        {denyButton}
      </>
    );
  }

  return (
    <>
      <ClientCard request={request} note />
      <div className="space-y-2">
        <div id="oauth-consent-access" className="text-sm font-medium">
          {t("access")}
        </div>
        <RadioGroup
          aria-labelledby="oauth-consent-access"
          value={access}
          onValueChange={(value) => setAccess(value as ConsentAccess)}
          className="grid-cols-1"
        >
          {choices.map((choice) => (
            <Label
              key={choice}
              htmlFor={`oauth-consent-${choice}`}
              className="has-data-checked:border-primary has-data-checked:bg-accent/40 gap-3 rounded-lg border p-3 font-normal"
            >
              <RadioGroupItem id={`oauth-consent-${choice}`} value={choice} />
              {t(`choice.${choice}`)}
            </Label>
          ))}
        </RadioGroup>
      </div>
      {request.requested.offline && (
        <p className="text-muted-foreground flex gap-2 text-sm">
          <Clock className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>{t("offline")}</span>
        </p>
      )}
      <Note>{t("privacy")}</Note>
      {failure && <FailureAlert failure={failure} />}
      <div className="space-y-2">
        <Button type="button" size="lg" className="w-full" disabled={busy} onClick={approve}>
          {t("approve")}
        </Button>
        {denyButton}
      </div>
      {reauth && (
        <StepUpDialog
          method={reauth}
          purpose="mcpConsent"
          confirm={approveWithPassword}
          onConfirmed={() => setReauth(null)}
          onClose={() => setReauth(null)}
          returnTo={`${pathname}?${request.oauthQuery}`}
        />
      )}
    </>
  );
}

function FailureAlert({ failure }: { failure: Failure }) {
  const t = useTranslations("auth.consent");
  return (
    <Alert variant="destructive">
      <AlertDescription>{t(failure)}</AlertDescription>
    </Alert>
  );
}

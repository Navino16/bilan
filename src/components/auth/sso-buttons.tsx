"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { LogIn } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { signIn } from "@/lib/auth-client";
import { isOriginError } from "@/lib/sso-errors";
import type { SsoProviderView } from "@/server/services/users/identities";

// On success the auth client itself navigates to the provider's authorization URL.
export function SsoButtons({
  providers,
  label,
  callbackURL,
  errorCallbackURL,
}: {
  providers: SsoProviderView[];
  label: "continueWith" | "signUpWith";
  callbackURL: string;
  errorCallbackURL: string;
}) {
  const t = useTranslations("auth.sso");
  const [pending, startTransition] = useTransition();
  const [failed, setFailed] = useState<"startFailed" | "badOrigin" | null>(null);

  function start(p: SsoProviderView) {
    setFailed(null);
    startTransition(async () => {
      // Absolute: Better Auth only accepts relative callbacks from a narrow character set.
      const abs = (path: string) => new URL(path, window.location.origin).href;
      const urls = { callbackURL: abs(callbackURL), errorCallbackURL: abs(errorCallbackURL) };
      const res = await signIn.social({ provider: p.providerId, ...urls });
      if (res.error) setFailed(isOriginError(res.error.code) ? "badOrigin" : "startFailed");
    });
  }

  if (providers.length === 0) return null;
  return (
    <div className="space-y-2" data-slot="sso-buttons">
      {providers.map((p) => (
        <Button
          key={p.providerId}
          type="button"
          variant="outline"
          className="h-auto min-h-8 w-full py-1.5 text-center wrap-anywhere whitespace-normal"
          disabled={pending}
          onClick={() => start(p)}
        >
          <LogIn />
          {t(label, { name: p.displayName })}
        </Button>
      ))}
      {failed && (
        <Alert variant="destructive">
          <AlertDescription>{t(failed)}</AlertDescription>
        </Alert>
      )}
    </div>
  );
}

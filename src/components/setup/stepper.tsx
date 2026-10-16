"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { StepAccount } from "./step-account";
import { StepSmtp } from "./step-smtp";
import { StepOidc } from "./step-oidc";
import { StepRegistrationMode } from "./step-registration-mode";

const ORDER = ["account", "smtp", "oidc", "registration"] as const;
type Step = (typeof ORDER)[number];

export type SmtpData = {
  host: string;
  port: string;
  secure: boolean;
  username: string;
  password: string;
  fromAddress: string;
  fromName: string;
};

export type OidcData = {
  displayName: string;
  issuer: string;
  clientId: string;
  clientSecret: string;
  scopes: string;
  pkce: boolean;
  authorizationUrl: string;
  tokenUrl: string;
  userInfoUrl: string;
  mapName: string;
  mapEmail: string;
};

export type SetupData = {
  name: string;
  email: string;
  password: string;
  mode: "OPEN" | "INVITE_ONLY" | "DISABLED";
  smtp: SmtpData;
  oidc: OidcData;
};

const EMPTY_SMTP: SmtpData = {
  host: "",
  port: "587",
  secure: false,
  username: "",
  password: "",
  fromAddress: "",
  fromName: "",
};

const EMPTY_OIDC: OidcData = {
  displayName: "",
  issuer: "",
  clientId: "",
  clientSecret: "",
  scopes: "openid,email,profile",
  pkce: true,
  authorizationUrl: "",
  tokenUrl: "",
  userInfoUrl: "",
  mapName: "",
  mapEmail: "",
};

export function Stepper({
  locale,
  oidcCallbackUrl,
  minPasswordLength,
}: {
  locale: string;
  oidcCallbackUrl: string;
  minPasswordLength: number;
}) {
  const t = useTranslations("setup.steps");
  const [current, setCurrent] = useState<Step>("account");
  const [data, setData] = useState<SetupData>({
    name: "",
    email: "",
    password: "",
    mode: "INVITE_ONLY",
    smtp: EMPTY_SMTP,
    oidc: EMPTY_OIDC,
  });
  const idx = ORDER.indexOf(current);

  // The user is created only on the final step (atomic completeSetupAction), so
  // navigating between steps never touches the DB and never trips the
  // setup-done guard mid-wizard.
  function next() {
    if (idx < ORDER.length - 1) setCurrent(ORDER[idx + 1]);
  }

  function patch(p: Partial<SetupData>) {
    setData((prev) => ({ ...prev, ...p }));
  }

  return (
    <div className="space-y-6">
      <ol className="text-muted-foreground flex flex-wrap gap-3 text-sm">
        {ORDER.map((s, i) => (
          <li key={s} className={i <= idx ? "text-foreground font-medium" : ""}>
            {i + 1}. {t(s)}
          </li>
        ))}
      </ol>
      {current === "account" && (
        <StepAccount
          data={data}
          onChange={patch}
          onNext={next}
          minPasswordLength={minPasswordLength}
        />
      )}
      {current === "smtp" && (
        <StepSmtp
          data={data.smtp}
          onChange={(p) => patch({ smtp: { ...data.smtp, ...p } })}
          onNext={next}
        />
      )}
      {current === "oidc" && (
        <StepOidc
          data={data.oidc}
          onChange={(p) => patch({ oidc: { ...data.oidc, ...p } })}
          onNext={next}
          callbackUrl={oidcCallbackUrl}
        />
      )}
      {current === "registration" && (
        <StepRegistrationMode
          data={data}
          onChange={patch}
          locale={locale}
          minPasswordLength={minPasswordLength}
        />
      )}
    </div>
  );
}

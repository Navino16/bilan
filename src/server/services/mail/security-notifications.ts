import { defaultLocale, type Locale } from "@/i18n/config";
import { db } from "@/server/db";
import { sendMail } from "@/server/services/mail/mailer";
import { logEvent } from "@/server/services/audit";
import { getAppName } from "@/server/services/settings/app-settings";
import { pickMailLocale } from "@/server/services/mail/locale";
import { describeUserAgent } from "@/lib/user-agent";
import { normalizeIp } from "@/lib/ip";
import { formatDateTime } from "@/lib/format";

// Best-effort security emails. `sendMail` already no-ops when SMTP is disabled;
// these wrappers additionally never throw into the auth path (a failed
// notification must not break login / password change) — failures are audited.

export type SecurityEvent =
  | "new_login"
  | "password_changed"
  | "passkey_added"
  | "two_factor_disabled";

type Origin = { ip: string | null; userAgent: string | null };

export type SignInMethod =
  | { kind: "password" | "totp" | "backup_code" | "passkey" }
  | { kind: "sso"; provider: string };

type Copy = {
  date: string;
  ip: string;
  device: string;
  unknownIp: string;
  unknownDevice: string;
  method: string;
  methods: Record<Exclude<SignInMethod["kind"], "sso">, string>;
  events: Record<
    SecurityEvent,
    (appName: string) => { subject: string; intro: string; outro: string[] }
  >;
};

const COPY: Record<Locale, Copy> = {
  fr: {
    date: "Date :",
    ip: "Adresse IP :",
    device: "Appareil :",
    unknownIp: "inconnue",
    unknownDevice: "inconnu",
    method: "Méthode de connexion :",
    methods: {
      password: "mot de passe",
      totp: "mot de passe et code d’authentification",
      backup_code: "mot de passe et code de secours",
      passkey: "clé d’accès",
    },
    events: {
      new_login: (appName) => ({
        subject: `${appName} — nouvelle connexion à votre compte`,
        intro: `Une nouvelle connexion à votre compte ${appName} vient d’avoir lieu.`,
        outro: [
          "Si vous êtes à l’origine de cette connexion, aucune action n’est requise.",
          "Sinon, changez immédiatement votre mot de passe.",
        ],
      }),
      password_changed: (appName) => ({
        subject: `${appName} — votre mot de passe a été modifié`,
        intro: `Le mot de passe de votre compte ${appName} vient d’être modifié.`,
        outro: [
          "Si vous n’êtes pas à l’origine de ce changement, contactez immédiatement l’administrateur de votre instance.",
        ],
      }),
      passkey_added: (appName) => ({
        subject: `${appName} — une clé d’accès a été ajoutée à votre compte`,
        intro: `Une nouvelle clé d’accès (passkey) permet désormais de se connecter à votre compte ${appName}.`,
        outro: [
          "Si vous êtes à l’origine de cet ajout, aucune action n’est requise.",
          "Sinon, supprimez-la depuis la page Sécurité et changez immédiatement votre mot de passe.",
        ],
      }),
      two_factor_disabled: (appName) => ({
        subject: `${appName} — la double authentification a été désactivée`,
        intro: `La double authentification vient d’être désactivée sur votre compte ${appName}.`,
        outro: [
          "Si vous êtes à l’origine de ce changement, aucune action n’est requise.",
          "Sinon, changez immédiatement votre mot de passe et réactivez la double authentification.",
        ],
      }),
    },
  },
  en: {
    date: "Date:",
    ip: "IP address:",
    device: "Device:",
    unknownIp: "unknown",
    unknownDevice: "unknown",
    method: "Sign-in method:",
    methods: {
      password: "password",
      totp: "password and authenticator code",
      backup_code: "password and backup code",
      passkey: "passkey",
    },
    events: {
      new_login: (appName) => ({
        subject: `${appName} — new sign-in to your account`,
        intro: `Someone just signed in to your ${appName} account.`,
        outro: [
          "If this was you, no action is needed.",
          "If not, change your password immediately.",
        ],
      }),
      password_changed: (appName) => ({
        subject: `${appName} — your password was changed`,
        intro: `The password for your ${appName} account was just changed.`,
        outro: ["If you didn’t make this change, contact your instance administrator immediately."],
      }),
      passkey_added: (appName) => ({
        subject: `${appName} — a passkey was added to your account`,
        intro: `A new passkey can now be used to sign in to your ${appName} account.`,
        outro: [
          "If you added it, no action is needed.",
          "If not, remove it from the Security page and change your password immediately.",
        ],
      }),
      two_factor_disabled: (appName) => ({
        subject: `${appName} — two-factor authentication was disabled`,
        intro: `Two-factor authentication was just turned off on your ${appName} account.`,
        outro: [
          "If this was you, no action is needed.",
          "If not, change your password immediately and turn two-factor authentication back on.",
        ],
      }),
    },
  },
};

export function formatIp(ip: string | null, locale: Locale): string {
  return normalizeIp(ip) ?? COPY[locale].unknownIp;
}

export function formatDevice(userAgent: string | null, locale: Locale): string {
  const { browser, os } = describeUserAgent(userAgent);
  const known = [browser, os].filter(Boolean).join(" · ");
  return known || userAgent?.slice(0, 80) || COPY[locale].unknownDevice;
}

function formatMethod(method: SignInMethod, locale: Locale): string {
  return method.kind === "sso" ? `${method.provider} (SSO)` : COPY[locale].methods[method.kind];
}

// Times are shown in UTC: users have no time-zone preference to format them in.
export function securityMail(
  event: SecurityEvent,
  locale: Locale,
  input: { appName: string; at: Date; origin?: Origin; method?: SignInMethod },
): { subject: string; text: string } {
  const copy = COPY[locale];
  const { subject, intro, outro } = copy.events[event](input.appName);
  const at = formatDateTime(input.at, locale, { timeZone: "UTC" });
  const method = input.method ? [`${copy.method} ${formatMethod(input.method, locale)}`] : [];
  const origin = input.origin
    ? [
        `${copy.ip} ${formatIp(input.origin.ip, locale)}`,
        `${copy.device} ${formatDevice(input.origin.userAgent, locale)}`,
      ]
    : [];
  return {
    subject,
    text: [intro, "", `${copy.date} ${at} (UTC)`, ...method, ...origin, "", ...outro].join("\n"),
  };
}

export async function notifySecurityEvent(
  event: SecurityEvent,
  // `pageLocale`: the triggering request's, for a user without a stored preference.
  input: { userId: string; at: Date; origin?: Origin; pageLocale?: Locale; method?: SignInMethod },
): Promise<void> {
  try {
    const user = await db.user.findUnique({
      where: { id: input.userId },
      select: { email: true, preference: { select: { locale: true } } },
    });
    if (!user) return;
    const locale = pickMailLocale(user.preference?.locale, input.pageLocale ?? defaultLocale);
    const mail = securityMail(event, locale, {
      appName: await getAppName(),
      at: input.at,
      origin: input.origin,
      method: input.method,
    });
    await sendMail({ to: user.email, ...mail, locale });
  } catch (e) {
    await logEvent({
      action: "mail.security.failed",
      metadata: { kind: event, error: e instanceof Error ? e.message : "unknown" },
    });
  }
}

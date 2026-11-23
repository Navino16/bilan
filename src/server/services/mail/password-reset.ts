import { defaultLocale, locales, type Locale } from "@/i18n/config";
import { env } from "@/env";
import { sendMail } from "@/server/services/mail/mailer";
import { mailLocale } from "@/server/services/mail/locale";
import { getAppName } from "@/server/services/settings/app-settings";

// Wired into Better Auth's resetPasswordTokenExpiresIn; the templates say "1 hour".
export const RESET_TOKEN_TTL_SEC = 60 * 60;

export type ResetKind = "reset" | "setup";

const RESET_PATH = new RegExp(`^/(${locales.join("|")})/reset/?$`);

// Better Auth hands us `<api>/reset-password/<token>?callbackURL=<redirectTo>`. The
// public endpoint accepts any same-origin redirectTo, so only the requesting page's
// locale and the setup flag are read from it.
export function resetRequest(url: string, appUrl: string): { locale: Locale; kind: ResetKind } {
  const origin = new URL(appUrl).origin;
  let locale: Locale = defaultLocale;
  let kind: ResetKind = "reset";
  try {
    const callback = new URL(url).searchParams.get("callbackURL");
    const target = callback ? new URL(callback, origin) : null;
    const match = target?.origin === origin ? RESET_PATH.exec(target.pathname) : null;
    if (match) {
      locale = match[1] as Locale;
      if (target!.searchParams.get("setup") === "1") kind = "setup";
    }
  } catch {
    // malformed URL → defaults
  }
  return { locale, kind };
}

// Always our reset page, never the requested redirect.
export function resetLink(token: string, locale: Locale, appUrl: string): string {
  return `${new URL(appUrl).origin}/${locale}/reset/${encodeURIComponent(token)}`;
}

type Template = (appName: string, link: string) => { subject: string; text: string };

const TEMPLATES: Record<ResetKind, Record<Locale, Template>> = {
  reset: {
    fr: (appName, link) => ({
      subject: `${appName} — réinitialisation de votre mot de passe`,
      text: [
        `Une réinitialisation du mot de passe de votre compte ${appName} a été demandée.`,
        "",
        "Choisissez un nouveau mot de passe ici (lien valable 1 heure) :",
        link,
        "",
        "Si vous n’êtes pas à l’origine de cette demande, ignorez ce message : votre mot de passe reste inchangé.",
      ].join("\n"),
    }),
    en: (appName, link) => ({
      subject: `${appName} — reset your password`,
      text: [
        `A password reset was requested for your ${appName} account.`,
        "",
        "Choose a new password here (link valid for 1 hour):",
        link,
        "",
        "If you didn’t request this, ignore this message: your password stays unchanged.",
      ].join("\n"),
    }),
  },
  setup: {
    fr: (appName, link) => ({
      subject: `${appName} — votre compte a été créé`,
      text: [
        `Un compte ${appName} vient d’être créé pour vous.`,
        "",
        "Choisissez votre mot de passe ici (lien valable 1 heure) :",
        link,
        "",
        "Passé ce délai, utilisez « Mot de passe oublié ? » sur la page de connexion.",
      ].join("\n"),
    }),
    en: (appName, link) => ({
      subject: `${appName} — your account has been created`,
      text: [
        `Your ${appName} account has just been created.`,
        "",
        "Choose your password here (link valid for 1 hour):",
        link,
        "",
        "After that, use “Forgot password?” on the sign-in page.",
      ].join("\n"),
    }),
  },
};

// The mail and its link follow the account's language, not the requesting page's.
export async function sendPasswordResetMail(
  input: { userId: string; email: string; url: string; token: string },
  appUrl: string = env.APP_URL,
): Promise<void> {
  const request = resetRequest(input.url, appUrl);
  const locale = await mailLocale(input.userId, request.locale);
  const link = resetLink(input.token, locale, appUrl);
  const { subject, text } = TEMPLATES[request.kind][locale](await getAppName(), link);
  await sendMail({ to: input.email, subject, text, locale, sensitive: true });
}

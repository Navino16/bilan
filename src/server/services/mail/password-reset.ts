import { defaultLocale, locales, type Locale } from "@/i18n/config";
import { sendMail } from "@/server/services/mail/mailer";
import { getAppName } from "@/server/services/settings/app-settings";

// Wired into Better Auth's resetPasswordTokenExpiresIn; the templates say "1 hour".
export const RESET_TOKEN_TTL_SEC = 60 * 60;

export type ResetKind = "reset" | "setup";

const RESET_PATH = new RegExp(`^/(${locales.join("|")})/reset/?$`);

// Better Auth hands us `<api>/reset-password/<token>?callbackURL=<redirectTo>`. The
// public endpoint accepts any same-origin redirectTo, so only the locale and the
// setup flag are read from it; the link always targets our reset page.
export function resetLink(
  url: string,
  token: string,
  appUrl: string,
): { link: string; locale: Locale; kind: ResetKind } {
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
  return { link: `${origin}/${locale}/reset/${encodeURIComponent(token)}`, locale, kind };
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

export async function sendPasswordResetMail(input: {
  email: string;
  link: string;
  locale: Locale;
  kind: ResetKind;
}): Promise<void> {
  const { subject, text } = TEMPLATES[input.kind][input.locale](await getAppName(), input.link);
  await sendMail({ to: input.email, subject, text, sensitive: true });
}

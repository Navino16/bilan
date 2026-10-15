import { env } from "@/env";
import { defaultLocale, type Locale } from "@/i18n/config";
import { sendMail } from "@/server/services/mail/mailer";
import { oneLine } from "@/server/services/mail/invitation";
import { isSmtpEnabled } from "@/server/services/settings/smtp";
import { logEvent } from "@/server/services/audit";
import { getAppName } from "@/server/services/settings/app-settings";
import { mailLocale } from "@/server/services/mail/locale";

// Wired into Better Auth's emailVerification.expiresIn; the templates say "24 hours".
export const VERIFY_TOKEN_TTL_SEC = 24 * 60 * 60;

export function verificationLink(token: string, locale: Locale, appUrl: string = env.APP_URL) {
  const origin = new URL(appUrl).origin;
  const callback = `${origin}/${locale}/verify-email`;
  return `${origin}/api/auth/verify-email?token=${encodeURIComponent(token)}&callbackURL=${encodeURIComponent(callback)}`;
}

type Input = { appName: string; account: string; link: string };

// The account name lets someone whose address was used by another person's sign-up tell.
const TEMPLATES: Record<Locale, (i: Input) => { subject: string; text: string }> = {
  fr: ({ appName, account, link }) => ({
    subject: `${appName} — vérifiez votre adresse e-mail`,
    text: [
      `Confirmez que cette adresse est bien la vôtre pour le compte « ${account} » sur ${appName} (lien valable 24 heures) :`,
      link,
      "",
      "Une fois l’adresse vérifiée, les invitations à rejoindre un foyer envoyées à cette adresse apparaîtront dans l’application.",
      "",
      "Si vous n’avez pas créé de compte, ignorez ce message.",
    ].join("\n"),
  }),
  en: ({ appName, account, link }) => ({
    subject: `${appName} — verify your email address`,
    text: [
      `Confirm this address is yours for the account “${account}” on ${appName} (link valid for 24 hours):`,
      link,
      "",
      "Once it’s verified, invitations to join a household sent to this address will show up in the app.",
      "",
      "If you didn’t create an account, ignore this message.",
    ].join("\n"),
  }),
};

export function verificationMail(locale: Locale, input: Input) {
  return TEMPLATES[locale]({ ...input, account: oneLine(input.account) });
}

type Delivery = {
  userId: string;
  email: string;
  name?: string | null;
  token: string;
  // The page that triggered the send; also covers a sign-up whose preference isn't stored yet.
  pageLocale?: Locale;
};

// Throws on a failed send; the caller checks that SMTP is enabled.
export async function deliverVerificationMail(input: Delivery): Promise<void> {
  const locale = await mailLocale(input.userId, input.pageLocale ?? defaultLocale);
  const mail = verificationMail(locale, {
    appName: await getAppName(),
    account: input.name?.trim() || input.email,
    link: verificationLink(input.token, locale),
  });
  await sendMail({ to: input.email, ...mail, locale, sensitive: true });
}

export async function auditVerificationMailFailure(userId: string, e: unknown): Promise<void> {
  await logEvent({
    action: "mail.security.failed",
    userId,
    metadata: { kind: "email_verification", error: e instanceof Error ? e.message : "unknown" },
  }).catch(() => {});
}

// Sign-up path: never throws, a failed mail can be resent from the banner.
export async function sendVerificationMail(input: Delivery): Promise<void> {
  try {
    if (await isSmtpEnabled()) await deliverVerificationMail(input);
  } catch (e) {
    await auditVerificationMailFailure(input.userId, e);
  }
}

import { sendMail } from "@/server/services/mail/mailer";
import { logEvent } from "@/server/services/audit";
import { getAppName } from "@/server/services/settings/app-settings";
import { describeUserAgent } from "@/lib/user-agent";

// Best-effort security emails. `sendMail` already no-ops when SMTP is disabled;
// these wrappers additionally never throw into the auth path (a failed
// notification must not break login / password change) — failures are audited.

// IPv4 clients reach a dual-stack server as "::ffff:a.b.c.d".
export function formatIp(ip: string | null): string {
  return ip ? ip.replace(/^::ffff:/i, "") : "inconnue";
}

export function formatDevice(userAgent: string | null): string {
  const { browser, os } = describeUserAgent(userAgent);
  const known = [browser, os].filter(Boolean).join(" · ");
  return known || userAgent?.slice(0, 80) || "inconnu";
}

function formatAt(at: Date): string {
  return new Intl.DateTimeFormat("fr-FR", {
    dateStyle: "long",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(at);
}

export async function notifyNewLogin(input: {
  email: string;
  ip: string | null;
  userAgent: string | null;
  at: Date;
}): Promise<void> {
  try {
    const appName = await getAppName();
    await sendMail({
      to: input.email,
      subject: `${appName} — nouvelle connexion à votre compte`,
      text: [
        `Une nouvelle connexion à votre compte ${appName} vient d'avoir lieu.`,
        "",
        `Date : ${formatAt(input.at)} (UTC)`,
        `Adresse IP : ${formatIp(input.ip)}`,
        `Appareil : ${formatDevice(input.userAgent)}`,
        "",
        "Si vous êtes à l'origine de cette connexion, aucune action n'est requise.",
        "Sinon, changez immédiatement votre mot de passe.",
      ].join("\n"),
    });
  } catch (e) {
    await logEvent({
      action: "mail.security.failed",
      metadata: { kind: "new_login", error: e instanceof Error ? e.message : "unknown" },
    });
  }
}

export async function notifyPasswordChanged(input: { email: string; at: Date }): Promise<void> {
  try {
    const appName = await getAppName();
    await sendMail({
      to: input.email,
      subject: `${appName} — votre mot de passe a été modifié`,
      text: [
        `Le mot de passe de votre compte ${appName} vient d'être modifié.`,
        "",
        `Date : ${formatAt(input.at)} (UTC)`,
        "",
        "Si vous n'êtes pas à l'origine de ce changement, contactez immédiatement",
        "l'administrateur de votre instance.",
      ].join("\n"),
    });
  } catch (e) {
    await logEvent({
      action: "mail.security.failed",
      metadata: { kind: "password_changed", error: e instanceof Error ? e.message : "unknown" },
    });
  }
}

export async function notifyPasskeyAdded(input: {
  email: string;
  ip: string | null;
  userAgent: string | null;
  at: Date;
}): Promise<void> {
  try {
    const appName = await getAppName();
    await sendMail({
      to: input.email,
      subject: `${appName} — une clé d'accès a été ajoutée à votre compte`,
      text: [
        `Une nouvelle clé d'accès (passkey) permet désormais de se connecter à votre compte ${appName}.`,
        "",
        `Date : ${formatAt(input.at)} (UTC)`,
        `Adresse IP : ${formatIp(input.ip)}`,
        `Appareil : ${formatDevice(input.userAgent)}`,
        "",
        "Si vous êtes à l'origine de cet ajout, aucune action n'est requise.",
        "Sinon, supprimez-la depuis la page Sécurité et changez immédiatement votre mot de passe.",
      ].join("\n"),
    });
  } catch (e) {
    await logEvent({
      action: "mail.security.failed",
      metadata: { kind: "passkey_added", error: e instanceof Error ? e.message : "unknown" },
    });
  }
}

export async function notifyTwoFactorDisabled(input: {
  email: string;
  ip: string | null;
  userAgent: string | null;
  at: Date;
}): Promise<void> {
  try {
    const appName = await getAppName();
    await sendMail({
      to: input.email,
      subject: `${appName} — la double authentification a été désactivée`,
      text: [
        `La double authentification vient d'être désactivée sur votre compte ${appName}.`,
        "",
        `Date : ${formatAt(input.at)} (UTC)`,
        `Adresse IP : ${formatIp(input.ip)}`,
        `Appareil : ${formatDevice(input.userAgent)}`,
        "",
        "Si vous êtes à l'origine de ce changement, aucune action n'est requise.",
        "Sinon, changez immédiatement votre mot de passe et réactivez la double authentification.",
      ].join("\n"),
    });
  } catch (e) {
    await logEvent({
      action: "mail.security.failed",
      metadata: { kind: "two_factor_disabled", error: e instanceof Error ? e.message : "unknown" },
    });
  }
}

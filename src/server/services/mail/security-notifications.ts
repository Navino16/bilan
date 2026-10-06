import { sendMail } from "@/server/services/mail/mailer";
import { logEvent } from "@/server/services/audit";
import { getAppName } from "@/server/services/settings/app-settings";

// Best-effort security emails. `sendMail` already no-ops when SMTP is disabled;
// these wrappers additionally never throw into the auth path (a failed
// notification must not break login / password change) — failures are audited.

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
        `Adresse IP : ${input.ip ?? "inconnue"}`,
        `Appareil : ${input.userAgent ?? "inconnu"}`,
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
        `Adresse IP : ${input.ip ?? "inconnue"}`,
        `Appareil : ${input.userAgent ?? "inconnu"}`,
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

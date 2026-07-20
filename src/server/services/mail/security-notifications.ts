import { sendMail } from "@/server/services/mail/mailer";
import { logEvent } from "@/server/services/audit";

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
    await sendMail({
      to: input.email,
      subject: "Bilan — nouvelle connexion à votre compte",
      text: [
        "Une nouvelle connexion à votre compte Bilan vient d'avoir lieu.",
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

export async function notifyPasswordChanged(input: {
  email: string;
  at: Date;
}): Promise<void> {
  try {
    await sendMail({
      to: input.email,
      subject: "Bilan — votre mot de passe a été modifié",
      text: [
        "Le mot de passe de votre compte Bilan vient d'être modifié.",
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

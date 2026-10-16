import nodemailer from "nodemailer";
import type { SmtpConfig, SmtpSecurity } from "@prisma/client";
import { db } from "@/server/db";
import { decrypt } from "@/server/crypto/encryption";
import { dataKey } from "@/server/crypto/keys";
import { env } from "@/env";
import type { Locale } from "@/i18n/config";

export type MailResult = { delivered: boolean };

// `locale`: the language the mail is written in (spec §3.4), sent as Content-Language.
export type Mail = { to: string; subject: string; text: string; locale: Locale };

// STARTTLS refuses to send if the server doesn't upgrade, so a stripped STARTTLS can't
// expose the password or reset links (#255).
const TRANSPORT_SECURITY: Record<
  SmtpSecurity,
  { secure: boolean; requireTLS?: boolean; ignoreTLS?: boolean }
> = {
  TLS: { secure: true },
  STARTTLS: { secure: false, requireTLS: true },
  NONE: { secure: false, ignoreTLS: true },
};

// Sends through `cfg` whether or not it is enabled (the admin SMTP test uses it directly).
export async function sendWithConfig(cfg: SmtpConfig, mail: Mail): Promise<void> {
  const transport = nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    ...TRANSPORT_SECURITY[cfg.security],
    auth: { user: cfg.username, pass: decrypt(cfg.passwordEnc, dataKey) },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  });
  await transport.sendMail({
    from: cfg.fromName ? `${cfg.fromName} <${cfg.fromAddress}>` : cfg.fromAddress,
    to: mail.to,
    subject: mail.subject,
    text: mail.text,
    headers: { "Content-Language": mail.locale },
  });
}

// Without an enabled SMTP config, logs the mail and reports delivered:false (dev/e2e/CI).
// `sensitive` bodies (reset links) are withheld from production logs.
export async function sendMail(opts: Mail & { sensitive?: boolean }): Promise<MailResult> {
  const cfg = await db.smtpConfig.findFirst({ where: { enabled: true } });
  if (!cfg) {
    const body = opts.sensitive && env.NODE_ENV === "production" ? "(body withheld)" : opts.text;
    console.info(`[bilan] mail to ${opts.to} — ${opts.subject}\n${body}`);
    return { delivered: false };
  }
  await sendWithConfig(cfg, opts);
  return { delivered: true };
}

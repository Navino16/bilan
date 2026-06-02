import nodemailer from "nodemailer";
import { db } from "@/server/db";
import { decrypt } from "@/server/crypto/encryption";
import { dataKey } from "@/server/crypto/keys";

export type MailResult = { delivered: boolean };

// Sends via the DB-configured SMTP when enabled; otherwise logs the body to the
// dev console and reports delivered:false (the caller audits the link too).
// Mirrors the Phase 1 password-reset fallback so e2e/CI never need a real SMTP.
export async function sendMail(opts: {
  to: string;
  subject: string;
  text: string;
}): Promise<MailResult> {
  const cfg = await db.smtpConfig.findFirst({ where: { enabled: true } });
  if (!cfg) {
    console.info(`[bilan][dev] mail to ${opts.to} — ${opts.subject}\n${opts.text}`);
    return { delivered: false };
  }
  const transport = nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    auth: { user: cfg.username, pass: decrypt(cfg.passwordEnc, dataKey) },
  });
  await transport.sendMail({
    from: cfg.fromName ? `${cfg.fromName} <${cfg.fromAddress}>` : cfg.fromAddress,
    to: opts.to,
    subject: opts.subject,
    text: opts.text,
  });
  return { delivered: true };
}

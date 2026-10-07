import nodemailer from "nodemailer";
import { db } from "@/server/db";
import { decrypt } from "@/server/crypto/encryption";
import { dataKey } from "@/server/crypto/keys";
import { env } from "@/env";

export type MailResult = { delivered: boolean };

// Without an enabled SMTP config, logs the mail and reports delivered:false (dev/e2e/CI).
// `sensitive` bodies (reset links) are withheld from production logs.
export async function sendMail(opts: {
  to: string;
  subject: string;
  text: string;
  sensitive?: boolean;
}): Promise<MailResult> {
  const cfg = await db.smtpConfig.findFirst({ where: { enabled: true } });
  if (!cfg) {
    const body = opts.sensitive && env.NODE_ENV === "production" ? "(body withheld)" : opts.text;
    console.info(`[bilan] mail to ${opts.to} — ${opts.subject}\n${body}`);
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

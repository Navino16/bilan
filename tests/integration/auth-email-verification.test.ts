import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";

type Mail = { to: string; subject: string; text: string; sensitive?: boolean };
const sent = vi.hoisted(() => [] as Mail[]);
const failing = vi.hoisted(() => ({ on: false }));
vi.mock("@/server/services/mail/mailer", () => ({
  sendMail: async (mail: Mail) => {
    if (failing.on) throw new Error("ECONNECTION");
    sent.push(mail);
    return { delivered: true };
  },
}));
const smtp = vi.hoisted(() => ({ enabled: true }));
vi.mock("@/server/services/settings/smtp", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/services/settings/smtp")>()),
  isSmtpEnabled: async () => smtp.enabled,
}));
const session = vi.hoisted(() => ({ user: { id: "", email: "" } }));
vi.mock("@/server/auth/permissions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/auth/permissions")>()),
  requireSession: async () => session.user,
}));
const request = vi.hoisted(() => ({ headers: new Headers() }));
vi.mock("next/headers", () => ({
  headers: async () => request.headers,
  cookies: async () => ({ get: () => undefined, set: () => {} }),
}));

import { createEmailVerificationToken } from "better-auth/api";
import { db } from "@/server/db";
import { env } from "@/env";
import { getAuth } from "@/server/auth";
import { verificationMailLimiter } from "@/server/auth/rate-limit";
import { resendVerificationEmailAction } from "@/server/transport/actions/email-verification";

vi.setConfig({ testTimeout: 20_000 });

const stamp = Date.now();
const appUrl = env.APP_URL.replace(/\/$/, "");
const password = "verify-strong-password-1";
const created: string[] = [];

async function signUp(label: string, headers: Headers = new Headers()) {
  const email = `verify-${label}+${stamp}@bilan.local`;
  request.headers = headers;
  const res = await (
    await getAuth()
  ).api.signUpEmail({
    body: { email, password, name: `Verify ${label}` },
  });
  created.push(res.user.id);
  return { id: res.user.id, email };
}

const mailTo = (email: string) => sent.filter((m) => m.to === email);
const linkIn = (mail: Mail) =>
  mail.text.split("\n").find((l) => l.startsWith(`${appUrl}/api/auth/verify-email?`))!;
const verified = async (id: string) =>
  (await db.user.findUniqueOrThrow({ where: { id } })).emailVerified;

async function follow(link: string) {
  const res = await (await getAuth()).handler(new Request(link));
  return { status: res.status, location: res.headers.get("location") };
}

beforeAll(() => {
  sent.length = 0;
});

beforeEach(() => {
  smtp.enabled = true;
  failing.on = false;
});

afterAll(async () => {
  await db.auditLog.deleteMany({ where: { userId: { in: created } } });
  await db.user.deleteMany({ where: { id: { in: created } } });
  await db.$disconnect();
});

describe("e-mail verification (#240)", () => {
  it("mails a localized link on sign-up, which verifies the address once followed", async () => {
    const user = await signUp("link", new Headers({ "accept-language": "en-US,en;q=0.9" }));
    const [mail] = mailTo(user.email);
    expect(mail.subject).toMatch(/verify your email address$/);
    expect(mail.text).toContain("for the account “Verify link” on");
    expect(mail.sensitive).toBe(true);
    const link = linkIn(mail);
    expect(new URL(link).searchParams.get("callbackURL")).toBe(`${appUrl}/en/verify-email`);
    expect(await verified(user.id)).toBe(false);

    expect(await follow(link)).toEqual({ status: 302, location: `${appUrl}/en/verify-email` });
    expect(await verified(user.id)).toBe(true);
    const audit = await db.auditLog.findFirst({
      where: { userId: user.id, action: "auth.email.verified" },
    });
    expect(audit?.metadata).toEqual({ via: "link" });
    expect(await db.session.count({ where: { userId: user.id } })).toBe(1);
  });

  it("sends nothing on sign-up while SMTP is off", async () => {
    smtp.enabled = false;
    const user = await signUp("nosmtp");
    expect(mailTo(user.email)).toEqual([]);
    expect(await verified(user.id)).toBe(false);
  });

  it("lands on the page with an error code for an expired or forged link", async () => {
    const user = await signUp("expired");
    const expired = await createEmailVerificationToken(env.AUTH_SECRET, user.email, undefined, -60);
    const callback = encodeURIComponent(`${appUrl}/fr/verify-email`);
    const base = `${appUrl}/api/auth/verify-email?callbackURL=${callback}&token=`;
    expect((await follow(base + expired)).location).toBe(
      `${appUrl}/fr/verify-email?error=TOKEN_EXPIRED`,
    );
    expect((await follow(`${base}forged`)).location).toBe(
      `${appUrl}/fr/verify-email?error=INVALID_TOKEN`,
    );
    expect(await verified(user.id)).toBe(false);
  });

  it("keeps the public resend endpoint closed", async () => {
    const user = await signUp("public");
    sent.length = 0;
    const res = await (
      await getAuth()
    ).handler(
      new Request(`${appUrl}/api/auth/send-verification-email`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: appUrl },
        body: JSON.stringify({ email: user.email }),
      }),
    );
    expect(res.status).toBe(404);
    expect(sent).toEqual([]);
  });

  it("resends to the signed-in user's own address, rate-limited", async () => {
    const user = await signUp("resend");
    session.user = user;
    verificationMailLimiter.reset(user.id);
    sent.length = 0;

    for (let i = 0; i < 3; i++) {
      expect(await resendVerificationEmailAction()).toEqual({ ok: true, status: "SENT" });
    }
    expect(await resendVerificationEmailAction()).toEqual({ ok: false, error: "RATE_LIMITED" });
    expect(sent.map((m) => m.to)).toEqual([user.email, user.email, user.email]);
    expect(
      await db.auditLog.count({
        where: { userId: user.id, action: "auth.email.verification_sent" },
      }),
    ).toBe(3);

    expect(await follow(linkIn(sent[2]))).toMatchObject({ status: 302 });
    expect(await verified(user.id)).toBe(true);
  });

  it("reports a failed resend, audited, without spending the rate limit", async () => {
    const user = await signUp("resendfail");
    session.user = user;
    verificationMailLimiter.reset(user.id);
    failing.on = true;
    for (let i = 0; i < 4; i++) {
      expect(await resendVerificationEmailAction()).toEqual({ ok: false, error: "FAILED" });
    }
    const audit = await db.auditLog.findFirst({
      where: { userId: user.id, action: "mail.security.failed" },
    });
    expect(audit?.metadata).toEqual({ kind: "email_verification", error: "ECONNECTION" });
    expect(
      await db.auditLog.count({
        where: { userId: user.id, action: "auth.email.verification_sent" },
      }),
    ).toBe(0);
    expect(verificationMailLimiter.consume(user.id).allowed).toBe(true);
  });

  it("swallows a failed mail on sign-up", async () => {
    failing.on = true;
    const user = await signUp("signupfail");
    expect(await verified(user.id)).toBe(false);
    expect(
      await db.auditLog.count({ where: { userId: user.id, action: "mail.security.failed" } }),
    ).toBe(1);
  });

  it("doesn't resend, nor spend the rate limit, when verified or without SMTP", async () => {
    const user = await signUp("noresend");
    session.user = user;
    verificationMailLimiter.reset(user.id);
    sent.length = 0;

    smtp.enabled = false;
    for (let i = 0; i < 4; i++) {
      expect(await resendVerificationEmailAction()).toEqual({ ok: false, error: "SMTP_DISABLED" });
    }
    smtp.enabled = true;
    await db.user.update({ where: { id: user.id }, data: { emailVerified: true } });
    expect(await resendVerificationEmailAction()).toEqual({
      ok: true,
      status: "ALREADY_VERIFIED",
    });
    expect(sent).toEqual([]);
    expect(verificationMailLimiter.consume(user.id).allowed).toBe(true);
  });
});

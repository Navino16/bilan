import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { db } from "@/server/db";
import { getAuth } from "@/server/auth";
import { isResetTokenValid } from "@/server/services/users/password-reset";
import { resetConfirmAction } from "@/server/transport/actions/auth";

type Mail = { to: string; subject: string; text: string; sensitive?: boolean };
const sent = vi.hoisted(() => [] as Mail[]);
vi.mock("@/server/services/mail/mailer", () => ({
  sendMail: async (mail: Mail) => {
    sent.push(mail);
    return { delivered: true };
  },
}));
const request = vi.hoisted(() => ({ headers: new Headers() }));
vi.mock("next/headers", () => ({
  headers: async () => request.headers,
  cookies: async () => ({ get: () => undefined, set: () => {} }),
}));
const notify = vi.hoisted(() => vi.fn());
vi.mock("@/server/services/mail/security-notifications", () => ({
  notifySecurityEvent: notify,
}));

const email = `pwreset+${Date.now()}@bilan.local`;
const password = "original-strong-password-1";
const appUrl = () => process.env.APP_URL!.replace(/\/$/, "");
let userId: string;
const changedAudits = () =>
  db.auditLog.count({ where: { userId, action: "auth.password.changed" } });

async function requestReset(): Promise<{ mail: Mail; link?: string; token: string }> {
  const auth = await getAuth();
  sent.length = 0;
  await auth.api.requestPasswordReset({ body: { email, redirectTo: `${appUrl()}/en/reset` } });
  // The mail is sent in the background so its latency can't reveal the account.
  const mail = await vi.waitFor(() => {
    const m = sent.find((x) => x.to === email && /reset your password/.test(x.subject));
    if (!m) throw new Error("reset mail not sent yet");
    return m;
  });
  const link = mail.text.split("\n").find((l) => l.startsWith(`${appUrl()}/en/reset/`));
  return { mail, link, token: decodeURIComponent(link?.split("/").pop() ?? "") };
}

beforeAll(async () => {
  const auth = await getAuth();
  const res = await auth.api.signUpEmail({ body: { email, password, name: "Pw Reset" } });
  userId = res.user.id;
});

afterAll(async () => {
  await db.auditLog.deleteMany({ where: { userId } });
  await db.user.deleteMany({ where: { email } });
  await db.$disconnect();
});

describe("password reset", () => {
  it("mails a localized link, and resetting revokes every session", async () => {
    const auth = await getAuth();
    await auth.api.signInEmail({ body: { email, password } });
    expect(await db.session.count({ where: { userId } })).toBeGreaterThan(0);

    const { mail, link, token } = await requestReset();
    expect(mail.sensitive).toBe(true);
    expect(link).toBeDefined();

    expect(await isResetTokenValid(token)).toBe(true);
    expect(await isResetTokenValid("not-a-token")).toBe(false);

    const verified = async () =>
      (await db.user.findUniqueOrThrow({ where: { id: userId } })).emailVerified;
    expect(await verified()).toBe(false);
    const trusted = { value: userId, identifier: { startsWith: "trust-device-" } };
    await db.verification.create({
      data: {
        id: `trust_${userId}`,
        identifier: `trust-device-${userId}`,
        value: userId,
        expiresAt: new Date(Date.now() + 86_400_000),
      },
    });
    await auth.api.resetPassword({ body: { token, newPassword: "brand-new-strong-password-2" } });
    expect(await db.session.count({ where: { userId } })).toBe(0);
    expect(await db.verification.count({ where: trusted })).toBe(0);
    expect(await isResetTokenValid(token)).toBe(false);
    // The mailed link proves the address (#240).
    expect(await verified()).toBe(true);
    const audit = await db.auditLog.findFirst({
      where: { userId, action: "auth.email.verified" },
    });
    expect(audit?.metadata).toEqual({ via: "password_reset" });
  });

  it("sends the password-changed alert with the request's IP and device (#230)", async () => {
    const { token } = await requestReset();
    notify.mockClear();
    const userAgent = "Mozilla/5.0 (X11; Linux x86_64) Firefox/131.0";
    request.headers = new Headers({ "user-agent": userAgent, "x-forwarded-for": "203.0.113.21" });
    const form = new FormData();
    form.set("token", token);
    form.set("password", "third-strong-password-3");

    expect(await resetConfirmAction(null, form)).toEqual({ ok: true });
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith("password_changed", {
      userId,
      at: expect.any(Date),
      origin: { ip: "203.0.113.21", userAgent },
    });
    expect(await changedAudits()).toBe(2);
  });

  it("neither audits nor alerts when the reset is refused", async () => {
    const { token } = await requestReset();
    notify.mockClear();
    const auth = await getAuth();
    await expect(
      auth.api.resetPassword({ body: { token, newPassword: "short" } }),
    ).rejects.toThrow();
    expect(notify).not.toHaveBeenCalled();
    expect(await changedAudits()).toBe(2);
    expect(await isResetTokenValid(token)).toBe(true);
  });
});

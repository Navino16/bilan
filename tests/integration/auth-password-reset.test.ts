import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { db } from "@/server/db";
import { getAuth } from "@/server/auth";
import { isResetTokenValid } from "@/server/services/users/password-reset";

type Mail = { to: string; subject: string; text: string; sensitive?: boolean };
const sent = vi.hoisted(() => [] as Mail[]);
vi.mock("@/server/services/mail/mailer", () => ({
  sendMail: async (mail: Mail) => {
    sent.push(mail);
    return { delivered: true };
  },
}));

const email = `pwreset+${Date.now()}@bilan.local`;
const password = "original-strong-password-1";
let userId: string;

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

    const appUrl = process.env.APP_URL!.replace(/\/$/, "");
    sent.length = 0;
    await auth.api.requestPasswordReset({ body: { email, redirectTo: `${appUrl}/en/reset` } });
    // The mail is sent in the background so its latency can't reveal the account.
    const mail = await vi.waitFor(() => {
      const m = sent.find((x) => x.to === email && /reset your password/.test(x.subject));
      if (!m) throw new Error("reset mail not sent yet");
      return m;
    });
    expect(mail.sensitive).toBe(true);
    const link = mail.text.split("\n").find((l) => l.startsWith(`${appUrl}/en/reset/`));
    expect(link).toBeDefined();
    const token = decodeURIComponent(link!.split("/").pop()!);

    expect(await isResetTokenValid(token)).toBe(true);
    expect(await isResetTokenValid("not-a-token")).toBe(false);

    await auth.api.resetPassword({ body: { token, newPassword: "brand-new-strong-password-2" } });
    expect(await db.session.count({ where: { userId } })).toBe(0);
    expect(await isResetTokenValid(token)).toBe(false);
  });
});

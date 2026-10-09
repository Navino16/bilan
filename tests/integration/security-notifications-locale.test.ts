import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

type Mail = { to: string; subject: string; text: string };
const sent = vi.hoisted(() => [] as Mail[]);
vi.mock("@/server/services/mail/mailer", () => ({
  sendMail: async (mail: Mail) => {
    sent.push(mail);
    return { delivered: true };
  },
}));

import { db } from "@/server/db";
import { env } from "@/env";
import { getAuth } from "@/server/auth";

const tag = "secmail-locale";
const password = "correct-horse-battery";
const appUrl = env.APP_URL.replace(/\/$/, "");
const email = (label: string) => `${tag}-${label}+${Date.now()}@bilan.local`;

async function cleanup() {
  const users = await db.user.findMany({
    where: { email: { contains: tag } },
    select: { id: true },
  });
  await db.auditLog.deleteMany({ where: { userId: { in: users.map((u) => u.id) } } });
  await db.user.deleteMany({ where: { email: { contains: tag } } });
}

beforeAll(cleanup);

afterAll(async () => {
  await cleanup();
  await db.$disconnect();
});

async function signUpAndIn(locale: "fr" | "en"): Promise<Mail> {
  const target = email(locale);
  const auth = await getAuth();
  await auth.api.signUpEmail({
    body: { email: target, password, name: locale },
    headers: new Headers({ referer: `${appUrl}/${locale}/register` }),
  });
  await auth.api.signInEmail({ body: { email: target, password } });
  return vi.waitFor(
    () => {
      const mail = sent.find((m) => m.to === target);
      if (!mail) throw new Error("login mail not sent yet");
      return mail;
    },
    { timeout: 5000 },
  );
}

describe("security notifications follow the signup locale (#214)", () => {
  it("mails an English sign-up in English", async () => {
    const mail = await signUpAndIn("en");
    expect(mail.subject).toMatch(/new sign-in to your account$/);
    expect(mail.text).toMatch(/^Date: .+ \(UTC\)$/m);
    expect(mail.text).toContain("If this was you, no action is needed.");
  });

  it("mails a French sign-up in French", async () => {
    const mail = await signUpAndIn("fr");
    expect(mail.subject).toMatch(/nouvelle connexion à votre compte$/);
    expect(mail.text).toMatch(/^Date : .+ \(UTC\)$/m);
  });
});

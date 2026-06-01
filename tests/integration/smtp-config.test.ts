import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "@/server/db";
import { upsertSmtp, getSmtpConfig, SMTP_SINGLETON_ID } from "@/server/services/settings/smtp";
import { decrypt } from "@/server/crypto/encryption";
import { dataKey } from "@/server/crypto/keys";

const actor = { id: "smtp_actor" };

beforeAll(async () => {
  await db.smtpConfig.deleteMany();
});

afterAll(async () => {
  await db.smtpConfig.deleteMany();
  await db.$disconnect();
});

describe("SMTP config service", () => {
  it("stores an encrypted, singleton SMTP config", async () => {
    const row = await upsertSmtp(
      {
        host: "smtp.example.com",
        port: 587,
        secure: true,
        username: "mailer",
        password: "super-secret",
        fromAddress: "bilan@example.com",
        fromName: "Bilan",
        enabled: true,
      },
      actor,
    );
    expect(row.id).toBe(SMTP_SINGLETON_ID);
    expect(row.passwordEnc).not.toBe("super-secret");
    expect(decrypt(row.passwordEnc, dataKey)).toBe("super-secret");
    expect(await db.smtpConfig.count()).toBe(1);
  });

  it("updates the same singleton row on a second upsert", async () => {
    await upsertSmtp(
      {
        host: "smtp2.example.com",
        port: 465,
        secure: true,
        username: "mailer2",
        password: "new-secret",
        fromAddress: "bilan@example.com",
        enabled: false,
      },
      actor,
    );
    expect(await db.smtpConfig.count()).toBe(1);
    const cfg = await getSmtpConfig();
    expect(cfg?.host).toBe("smtp2.example.com");
    expect(cfg?.enabled).toBe(false);
  });
});

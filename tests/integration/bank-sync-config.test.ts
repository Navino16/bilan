import { generateKeyPairSync } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { env } from "@/env";
import { decrypt } from "@/server/crypto/encryption";
import { dataKey } from "@/server/crypto/keys";
import {
  BANK_SYNC_SINGLETON_ID,
  BankSyncConfigError,
  bankSyncClient,
  bankSyncConfigSchema,
  bankSyncRedirectUrl,
  deleteBankSyncConfig,
  getBankSyncConfig,
  isBankSyncAvailable,
  recentRateLimit,
  testBankSyncConfig,
  upsertBankSyncConfig,
} from "@/server/services/bank-sync/config";
import { fakeEnableBanking, testKeyPair } from "../fixtures/enable-banking";

const actor = { id: "bsc_actor" };
const pem = testKeyPair().privateKeyPem;

async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (e) {
    expect(e).toBeInstanceOf(BankSyncConfigError);
    return (e as BankSyncConfigError).code;
  }
  throw new Error("expected a rejection");
}

beforeAll(async () => {
  await db.user.create({ data: { id: actor.id, email: "bsc-actor@bilan.local" } });
});

beforeEach(async () => {
  await db.bankSyncConfig.deleteMany({ where: { id: BANK_SYNC_SINGLETON_ID } });
});

afterAll(async () => {
  await db.bankSyncConfig.deleteMany({ where: { id: BANK_SYNC_SINGLETON_ID } });
  await db.auditLog.deleteMany({ where: { userId: actor.id } });
  await db.user.deleteMany({ where: { id: actor.id } });
  await db.$disconnect();
});

describe("bank sync config", () => {
  it("stores the key encrypted and keeps it when the field is left blank", async () => {
    const row = await upsertBankSyncConfig(
      { applicationId: "app-test-id", privateKey: pem, enabled: true },
      actor,
    );
    expect(row.id).toBe(BANK_SYNC_SINGLETON_ID);
    expect(decrypt(row.privateKeyEnc, dataKey)).toBe(pem);
    expect(row.privateKeyEnc).not.toContain("PRIVATE KEY");

    const kept = await upsertBankSyncConfig(
      { applicationId: "app-test-id", privateKey: "", enabled: false },
      actor,
    );
    expect(kept.privateKeyEnc).toBe(row.privateKeyEnc);
    expect(kept.enabled).toBe(false);
    expect(await db.bankSyncConfig.count()).toBe(1);
  });

  it("stores a sync interval of 6, 12 or 24 hours, 6 by default", async () => {
    const row = await upsertBankSyncConfig(
      { applicationId: "app-test-id", privateKey: pem, enabled: true },
      actor,
    );
    expect(row.syncIntervalHours).toBe(6);
    const twelve = await upsertBankSyncConfig(
      { applicationId: "app-test-id", privateKey: "", enabled: true, syncIntervalHours: 12 },
      actor,
    );
    expect(twelve.syncIntervalHours).toBe(12);
    for (const syncIntervalHours of [8, 0, 6.5]) {
      expect(
        bankSyncConfigSchema.safeParse({ applicationId: "app-test-id", syncIntervalHours }).success,
      ).toBe(false);
    }
  });

  it("reports a bank rate limit for a week", async () => {
    const at = new Date("2026-11-03T10:00:00.000Z");
    const row = await upsertBankSyncConfig(
      { applicationId: "app-test-id", privateKey: pem, enabled: true },
      actor,
    );
    expect(recentRateLimit(row, at)).toBeNull();
    const limited = { ...row, lastRateLimitedAt: at };
    expect(recentRateLimit(limited, new Date(at.getTime() + 6 * 86_400_000))).toEqual(at);
    expect(recentRateLimit(limited, new Date(at.getTime() + 8 * 86_400_000))).toBeNull();
  });

  it("asks for the key on first save and for another application id", async () => {
    expect(
      await codeOf(
        upsertBankSyncConfig(
          { applicationId: "app-test-id", privateKey: "", enabled: true },
          actor,
        ),
      ),
    ).toBe("KEY_REQUIRED");

    await upsertBankSyncConfig(
      { applicationId: "app-test-id", privateKey: pem, enabled: true },
      actor,
    );
    expect(
      await codeOf(
        upsertBankSyncConfig({ applicationId: "other-app", privateKey: "", enabled: true }, actor),
      ),
    ).toBe("KEY_REQUIRED");
    expect((await getBankSyncConfig())?.applicationId).toBe("app-test-id");
  });

  it("refuses a key that is not an RSA private key", async () => {
    const ec = generateKeyPairSync("ec", { namedCurve: "P-256" })
      .privateKey.export({ type: "pkcs8", format: "pem" })
      .toString();
    const rsaPublic = testKeyPair().publicKey.export({ type: "spki", format: "pem" }).toString();
    for (const privateKey of ["not a pem", ec, rsaPublic]) {
      expect(
        await codeOf(
          upsertBankSyncConfig({ applicationId: "app-test-id", privateKey, enabled: true }, actor),
        ),
      ).toBe("INVALID_KEY");
    }
    expect(await getBankSyncConfig()).toBeNull();
  });

  it("is available only once configured and enabled", async () => {
    expect(await isBankSyncAvailable()).toBe(false);
    await upsertBankSyncConfig(
      { applicationId: "app-test-id", privateKey: pem, enabled: false },
      actor,
    );
    expect(await isBankSyncAvailable()).toBe(false);
    expect(await bankSyncClient()).toBeNull();
    expect(await bankSyncClient({ requireEnabled: false })).not.toBeNull();
    await upsertBankSyncConfig(
      { applicationId: "app-test-id", privateKey: "", enabled: true },
      actor,
    );
    expect(await isBankSyncAvailable()).toBe(true);
    expect(await bankSyncClient()).not.toBeNull();
  });

  it("builds the redirect URL from APP_URL", () => {
    expect(bankSyncRedirectUrl()).toBe(new URL("/api/bank-sync/callback", env.APP_URL).href);
  });

  it("tests the application and counts the banks", async () => {
    await upsertBankSyncConfig(
      { applicationId: "app-test-id", privateKey: pem, enabled: false },
      actor,
    );
    const bank = fakeEnableBanking();
    expect(await testBankSyncConfig(actor, { fetch: bank.fetch })).toEqual({
      ok: true,
      application: { name: "Bilan test", environment: "PRODUCTION", active: true },
      aspspCount: 2,
    });
    expect(bank.calls.map((c) => `${c.method} ${c.path}?${c.query}`)).toEqual([
      "GET /application?",
      "GET /aspsps?country=FR",
    ]);
    const audit = await db.auditLog.findFirst({
      where: { userId: actor.id, action: "settings.bankSync.test" },
      orderBy: { createdAt: "desc" },
    });
    expect(audit?.metadata).toEqual({ ok: true });
  });

  it("explains an inactive application", async () => {
    expect(await testBankSyncConfig(actor)).toEqual({ ok: false, error: "NOT_CONFIGURED" });

    await upsertBankSyncConfig(
      { applicationId: "app-test-id", privateKey: pem, enabled: true },
      actor,
    );
    const bank = fakeEnableBanking();
    bank.on("GET", "/application", {
      status: 403,
      body: { message: "Application is not active" },
    });
    expect(await testBankSyncConfig(actor, { fetch: bank.fetch })).toEqual({
      ok: false,
      error: "APP_INACTIVE",
    });
    const audit = await db.auditLog.findFirst({
      where: { userId: actor.id, action: "settings.bankSync.test" },
      orderBy: { createdAt: "desc" },
    });
    expect(audit?.metadata).toEqual({ ok: false, error: "APP_INACTIVE" });
  });

  it("keeps the key out of audit payloads", async () => {
    await upsertBankSyncConfig(
      { applicationId: "app-test-id", privateKey: pem, enabled: true },
      actor,
    );
    await upsertBankSyncConfig(
      { applicationId: "app-test-id", privateKey: "", enabled: false },
      actor,
    );
    expect(await deleteBankSyncConfig(actor)).toBe(true);
    expect(await deleteBankSyncConfig(actor)).toBe(false);

    const rows = await db.auditLog.findMany({
      where: { userId: actor.id },
      orderBy: { createdAt: "asc" },
    });
    for (const row of rows) {
      const dumped = JSON.stringify(row.metadata);
      expect(dumped).not.toContain("PRIVATE KEY");
      expect(dumped).not.toContain("app-test-id");
    }
    const updates = rows.filter((r) => r.action === "settings.bankSync.update");
    expect(updates.slice(-2).map((r) => r.metadata)).toEqual([
      { enabled: true, keyChanged: true, syncIntervalHours: 6 },
      { enabled: false, keyChanged: false, syncIntervalHours: 6 },
    ]);
    expect(rows.filter((r) => r.action === "settings.bankSync.delete")).toHaveLength(1);
  });
});

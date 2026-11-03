import { createPrivateKey } from "node:crypto";
import { z } from "zod";
import type { BankSyncConfig } from "@prisma/client";
import { env } from "@/env";
import { isSyncInterval } from "@/lib/bank-sync";
import { db } from "@/server/db";
import { decrypt, encrypt } from "@/server/crypto/encryption";
import { dataKey } from "@/server/crypto/keys";
import { logEvent } from "@/server/services/audit";
import {
  createEnableBankingClient,
  EnableBankingError,
  type BankSyncErrorCode,
  type EnableBankingClient,
} from "@/server/services/bank-sync/client";

export const BANK_SYNC_SINGLETON_ID = "default";

export const bankSyncConfigSchema = z.object({
  applicationId: z.string().trim().min(1).max(100),
  privateKey: z.string().default(""),
  enabled: z.boolean().default(false),
  syncIntervalHours: z.number().refine(isSyncInterval).default(6),
});
export type BankSyncConfigInput = z.input<typeof bankSyncConfigSchema>;

export class BankSyncConfigError extends Error {
  constructor(readonly code: "KEY_REQUIRED" | "INVALID_KEY") {
    super(code);
  }
}

function assertRsaPrivateKey(pem: string): void {
  try {
    if (createPrivateKey(pem).asymmetricKeyType === "rsa") return;
  } catch {}
  throw new BankSyncConfigError("INVALID_KEY");
}

export function getBankSyncConfig(): Promise<BankSyncConfig | null> {
  return db.bankSyncConfig.findUnique({ where: { id: BANK_SYNC_SINGLETON_ID } });
}

export async function upsertBankSyncConfig(
  input: BankSyncConfigInput,
  actor: { id: string },
): Promise<BankSyncConfig> {
  const parsed = bankSyncConfigSchema.parse(input);
  const keyChanged = parsed.privateKey.trim().length > 0;
  let privateKeyEnc: string;
  if (keyChanged) {
    assertRsaPrivateKey(parsed.privateKey);
    privateKeyEnc = encrypt(parsed.privateKey, dataKey);
  } else {
    // A key is tied to its application id.
    const existing = await getBankSyncConfig();
    if (existing?.applicationId !== parsed.applicationId) {
      throw new BankSyncConfigError("KEY_REQUIRED");
    }
    privateKeyEnc = existing.privateKeyEnc;
  }

  const data = {
    applicationId: parsed.applicationId,
    privateKeyEnc,
    enabled: parsed.enabled,
    syncIntervalHours: parsed.syncIntervalHours,
    updatedById: actor.id,
  };
  const row = await db.bankSyncConfig.upsert({
    where: { id: BANK_SYNC_SINGLETON_ID },
    create: { id: BANK_SYNC_SINGLETON_ID, ...data },
    update: data,
  });
  await logEvent({
    userId: actor.id,
    action: "settings.bankSync.update",
    entity: "BankSyncConfig",
    entityId: row.id,
    metadata: { enabled: row.enabled, keyChanged, syncIntervalHours: row.syncIntervalHours },
  });
  return row;
}

export async function deleteBankSyncConfig(actor: { id: string }): Promise<boolean> {
  const { count } = await db.bankSyncConfig.deleteMany({ where: { id: BANK_SYNC_SINGLETON_ID } });
  if (count > 0) {
    await logEvent({
      userId: actor.id,
      action: "settings.bankSync.delete",
      entity: "BankSyncConfig",
      entityId: BANK_SYNC_SINGLETON_ID,
    });
  }
  return count > 0;
}

export async function isBankSyncAvailable(): Promise<boolean> {
  return (await getBankSyncConfig())?.enabled ?? false;
}

const RATE_LIMIT_NOTICE_MS = 7 * 86_400_000;

export function recentRateLimit(cfg: BankSyncConfig, now = new Date()): Date | null {
  const at = cfg.lastRateLimitedAt;
  return at && now.getTime() - at.getTime() < RATE_LIMIT_NOTICE_MS ? at : null;
}

export function bankSyncRedirectUrl(): string {
  return new URL("/api/bank-sync/callback", env.APP_URL).href;
}

export async function bankSyncClient(
  opts: { fetch?: typeof fetch; requireEnabled?: boolean } = {},
): Promise<EnableBankingClient | null> {
  const cfg = await getBankSyncConfig();
  if (!cfg || ((opts.requireEnabled ?? true) && !cfg.enabled)) return null;
  return createEnableBankingClient({
    applicationId: cfg.applicationId,
    privateKeyPem: decrypt(cfg.privateKeyEnc, dataKey),
    fetch: opts.fetch,
  });
}

export type BankSyncTestResult =
  | {
      ok: true;
      application: { name: string; environment: string | null; active: boolean };
      aspspCount: number;
    }
  | { ok: false; error: "NOT_CONFIGURED" | BankSyncErrorCode };

// Runs on the saved config, enabled or not, like the SMTP test.
export async function testBankSyncConfig(
  actor: { id: string },
  opts: { fetch?: typeof fetch } = {},
): Promise<BankSyncTestResult> {
  const cfg = await getBankSyncConfig();
  if (!cfg) return { ok: false, error: "NOT_CONFIGURED" };
  let result: BankSyncTestResult;
  try {
    const client = await bankSyncClient({ fetch: opts.fetch, requireEnabled: false });
    if (!client) return { ok: false, error: "NOT_CONFIGURED" };
    const application = await client.application();
    const aspsps = await client.aspsps("FR");
    result = {
      ok: true,
      application: {
        name: application.name,
        environment: application.environment ?? null,
        active: application.active ?? false,
      },
      aspspCount: aspsps.length,
    };
  } catch (e) {
    if (e instanceof EnableBankingError) {
      result = { ok: false, error: e.code };
    } else {
      console.error("[bilan] bank sync test failed", e instanceof Error ? e.name : typeof e);
      result = { ok: false, error: "HTTP" };
    }
  }
  await logEvent({
    userId: actor.id,
    action: "settings.bankSync.test",
    entity: "BankSyncConfig",
    entityId: cfg.id,
    metadata: result.ok ? { ok: true } : { ok: false, error: result.error },
  });
  return result;
}

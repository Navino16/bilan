import { createHmac } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { APIError, getSessionFromCtx } from "better-auth/api";
import { symmetricDecrypt } from "better-auth/crypto";
import { db } from "@/server/db";
import { logEvent } from "@/server/services/audit";
import type { HookContext } from "./auth-audit";

// Passed to twoFactor() so the guard below matches codes exactly as Better Auth does.
export const TOTP_OPTIONS = { period: 30, digits: 6 } as const;
// Better Auth's verify() window, not configurable through the plugin options.
const WINDOW = 1;

// RFC 4226 HOTP; Better Auth keys the HMAC with the secret string itself.
export function hotp(secret: string, counter: number): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const mac = createHmac("sha1", Buffer.from(secret, "utf8")).update(msg).digest();
  const offset = mac[mac.length - 1] & 0xf;
  const bin = (mac.readUInt32BE(offset) & 0x7fffffff) % 10 ** TOTP_OPTIONS.digits;
  return bin.toString().padStart(TOTP_OPTIONS.digits, "0");
}

export function totpStep(nowMs: number): number {
  return Math.floor(nowMs / (TOTP_OPTIONS.period * 1000));
}

export function matchTotpStep(secret: string, code: string, nowMs: number): number | null {
  const current = totpStep(nowMs);
  for (let step = current - WINDOW; step <= current + WINDOW; step++) {
    if (hotp(secret, step) === code) return step;
  }
  return null;
}

// False when this step (or a later one) was already accepted.
export async function claimTotpStep(
  twoFactorId: string,
  step: number,
  database: PrismaClient = db,
): Promise<boolean> {
  const { count } = await database.twoFactor.updateMany({
    where: { id: twoFactorId, OR: [{ lastUsedStep: null }, { lastUsedStep: { lt: step } }] },
    data: { lastUsedStep: step },
  });
  return count > 0;
}

// RFC 6238 §5.2: a TOTP code is accepted once. Runs before Better Auth's own check, which
// still rejects codes that don't match; a step claimed here by a request that then fails
// for another reason stays used.
export async function totpReplayGuard(
  ctx: HookContext,
  pending: { userId: string } | null,
): Promise<void> {
  if (ctx.path !== "/two-factor/verify-totp") return;
  const code = (ctx.body as { code?: unknown } | null)?.code;
  if (typeof code !== "string") return;
  const session = await getSessionFromCtx(ctx);
  const userId = session?.user.id ?? pending?.userId;
  if (!userId) return;
  const row = await db.twoFactor.findFirst({
    where: { userId },
    select: { id: true, secret: true },
  });
  if (!row) return;

  const secret = await symmetricDecrypt({ key: ctx.context.secretConfig, data: row.secret });
  const step = matchTotpStep(secret, code, Date.now());
  if (step === null || (await claimTotpStep(row.id, step))) return;

  if (!session) {
    await logEvent({
      userId,
      action: "auth.login.failed",
      metadata: { method: "totp", reason: "CODE_REUSED" },
    });
  }
  throw new APIError("UNAUTHORIZED", { code: "INVALID_CODE", message: "Invalid code" });
}

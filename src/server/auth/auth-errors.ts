import { APIError, isAPIError } from "better-auth/api";

type DbError = {
  code?: unknown;
  meta?: { modelName?: unknown };
  cause?: { code?: unknown; message?: unknown };
};

// Losers of a concurrent backup-code use: Better Auth consumes the code with a conditional
// update of the TwoFactor row, which MariaDB refuses (1020) or Prisma finds gone (P2025).
export function isTwoFactorWriteConflict(err: unknown): boolean {
  const e = (err ?? {}) as DbError;
  if (e.code === "P2025") return e.meta?.modelName === "TwoFactor";
  return (
    e.cause?.code === 1020 &&
    typeof e.cause.message === "string" &&
    e.cause.message.includes("'TwoFactor'")
  );
}

// Better Auth's onAPIError.onError: a thrown APIError becomes the response.
export function onAuthError(err: unknown): void {
  if (isTwoFactorWriteConflict(err)) {
    throw new APIError("UNAUTHORIZED", {
      code: "INVALID_BACKUP_CODE",
      message: "Invalid backup code",
    });
  }
  // Setting onError mutes Better Auth's own logging; the router still logs non-API errors.
  if (isAPIError(err) && err.status === "INTERNAL_SERVER_ERROR") console.error("[bilan] auth", err);
}

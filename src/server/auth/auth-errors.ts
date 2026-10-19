import { isAPIError } from "better-auth/api";
import { db } from "@/server/db";

type DriverCause = { code?: unknown; message?: unknown };
type DbError = {
  code?: unknown;
  meta?: { modelName?: unknown; driverAdapterError?: { cause?: DriverCause } };
  cause?: DriverCause;
};

// Losers of a concurrent backup-code use: Better Auth consumes the code with a conditional
// update of the TwoFactor row, which MariaDB refuses (1020) or Prisma finds gone (P2025).
// Prisma 7.10+ wraps the driver error under meta.driverAdapterError (code P2039).
export function isTwoFactorWriteConflict(err: unknown): boolean {
  const e = (err ?? {}) as DbError;
  if (e.code === "P2025") return e.meta?.modelName === "TwoFactor";
  const cause = e.cause ?? e.meta?.driverAdapterError?.cause;
  return (
    cause?.code === 1020 &&
    typeof cause.message === "string" &&
    cause.message.includes("'TwoFactor'")
  );
}

// The client Better Auth writes through. A refused TwoFactor update reads as "no row updated",
// which Better Auth answers with a 409 (#243): its onAPIError hook can't replace a response.
export const authDb = db.$extends({
  query: {
    twoFactor: {
      async update({ args, query }) {
        try {
          return await query(args);
        } catch (err) {
          if (isTwoFactorWriteConflict(err)) return null as never;
          throw err;
        }
      },
    },
  },
});

// Better Auth's onAPIError.onError.
export function onAuthError(err: unknown): void {
  // Setting onError mutes Better Auth's own logging; the router still logs non-API errors.
  if (isAPIError(err) && err.status === "INTERNAL_SERVER_ERROR") console.error("[bilan] auth", err);
}

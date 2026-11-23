import { db } from "@/server/db";
import { isTwoFactorWriteConflict } from "./auth-errors";

type UpdateCall = { args: { where?: object }; query: (args: unknown) => Promise<unknown> };

// Better Auth consumes a backup code with an update conditioned on the old `backupCodes`;
// MariaDB refuses the losers of a concurrent use (1020). As "no row updated", Better Auth
// answers 409 (#243): its onAPIError hook can't replace a response since 1.7.
export async function twoFactorUpdate({ args, query }: UpdateCall): Promise<unknown> {
  try {
    return await query(args);
  } catch (err) {
    if (args.where && "backupCodes" in args.where && isTwoFactorWriteConflict(err)) return null;
    throw err;
  }
}

// The client Better Auth writes through.
export const authDb = db.$extends({
  query: { twoFactor: { update: (call) => twoFactorUpdate(call) as never } },
});

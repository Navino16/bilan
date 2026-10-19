import { describe, it, expect } from "vitest";
import { isAPIError } from "better-auth/api";
import { isTwoFactorWriteConflict, onAuthError } from "@/server/auth/auth-errors";

const mariadb1020 = (table: string) => ({
  cause: {
    kind: "mysql",
    code: 1020,
    message: `Record has changed since last read in table '${table}'; try restarting transaction`,
  },
});

// Prisma 7.10+: the driver error sits under meta.driverAdapterError (code P2039).
const prismaWrapped1020 = (table: string) => ({
  code: "P2039",
  meta: { modelName: table, driverAdapterError: mariadb1020(table) },
});

describe("isTwoFactorWriteConflict (#243 SEC-04)", () => {
  it("recognizes a conflicting update of the TwoFactor row", () => {
    expect(isTwoFactorWriteConflict(mariadb1020("TwoFactor"))).toBe(true);
    expect(isTwoFactorWriteConflict(prismaWrapped1020("TwoFactor"))).toBe(true);
    expect(isTwoFactorWriteConflict({ code: "P2025", meta: { modelName: "TwoFactor" } })).toBe(
      true,
    );
  });

  it("leaves other errors alone", () => {
    expect(isTwoFactorWriteConflict(mariadb1020("Session"))).toBe(false);
    expect(isTwoFactorWriteConflict(prismaWrapped1020("Session"))).toBe(false);
    expect(isTwoFactorWriteConflict({ code: "P2025", meta: { modelName: "User" } })).toBe(false);
    expect(isTwoFactorWriteConflict(new Error("boom"))).toBe(false);
    expect(isTwoFactorWriteConflict(null)).toBe(false);
  });
});

describe("onAuthError", () => {
  it("turns the conflict into a 401 invalid backup code", () => {
    let thrown: unknown;
    try {
      onAuthError(mariadb1020("TwoFactor"));
    } catch (e) {
      thrown = e;
    }
    expect(isAPIError(thrown)).toBe(true);
    expect(thrown).toMatchObject({ statusCode: 401, body: { code: "INVALID_BACKUP_CODE" } });
  });

  it("lets any other error through", () => {
    expect(() => onAuthError(new Error("boom"))).not.toThrow();
  });
});

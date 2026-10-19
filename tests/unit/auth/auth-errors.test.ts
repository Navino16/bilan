import { describe, it, expect } from "vitest";
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
  it("lets errors through", () => {
    expect(() => onAuthError(mariadb1020("TwoFactor"))).not.toThrow();
    expect(() => onAuthError(new Error("boom"))).not.toThrow();
  });
});

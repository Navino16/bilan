import { describe, it, expect, vi } from "vitest";

vi.mock("@/server/db", () => ({ db: { $extends: () => ({}) } }));

import { twoFactorUpdate } from "@/server/auth/auth-db";

const conflict = {
  cause: {
    code: 1020,
    message: "Record has changed since last read in table 'TwoFactor'; try restarting transaction",
  },
};
const failing = (err: unknown) => () => Promise.reject(err);

describe("twoFactorUpdate (#243)", () => {
  it("reads a refused backup-code consumption as no row updated", async () => {
    const args = { where: { id: "tf1", backupCodes: "old" } };
    expect(await twoFactorUpdate({ args, query: failing(conflict) })).toBeNull();
  });

  it("lets a conflict on any other TwoFactor write through", async () => {
    const args = { where: { id: "tf1" } };
    await expect(twoFactorUpdate({ args, query: failing(conflict) })).rejects.toBe(conflict);
  });

  it("lets other errors through and returns the updated row", async () => {
    const args = { where: { id: "tf1", backupCodes: "old" } };
    const boom = new Error("boom");
    await expect(twoFactorUpdate({ args, query: failing(boom) })).rejects.toBe(boom);
    const row = { id: "tf1" };
    expect(await twoFactorUpdate({ args, query: async () => row })).toBe(row);
  });
});

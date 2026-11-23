import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { db } from "@/server/db";
import { createTransaction } from "@/server/services/transactions";

vi.mock("@/server/services/links/auto", () => ({
  autoLinkTransfers: vi.fn().mockRejectedValue(new Error("boom")),
}));

const owner = "autolink_manual_fail";
let accountId: string;

beforeAll(async () => {
  await db.user.deleteMany({ where: { id: owner } });
  await db.user.create({ data: { id: owner, email: `${owner}@bilan.local` } });
  accountId = (
    await db.bankAccount.create({ data: { ownerId: owner, name: "Courant", type: "CHECKING" } })
  ).id;
});

afterAll(async () => {
  await db.auditLog.deleteMany({ where: { userId: owner } });
  await db.transaction.deleteMany({ where: { accountId } });
  await db.bankAccount.deleteMany({ where: { ownerId: owner } });
  await db.user.deleteMany({ where: { id: owner } });
  await db.$disconnect();
});

describe("manual entry with a failing auto-link", () => {
  it("still saves and audits the transaction", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { id } = await createTransaction(
      { accountId, date: "2026-04-03", amount: -12, type: "CARD", label: "CB BOULANGERIE" },
      { id: owner },
      { autoLink: true },
    );
    expect(await db.transaction.count({ where: { id } })).toBe(1);
    expect(
      await db.auditLog.count({ where: { action: "transaction.created", entityId: id } }),
    ).toBe(1);
  });
});

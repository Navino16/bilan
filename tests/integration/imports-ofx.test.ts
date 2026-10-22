import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "@/server/db";
import { decrypt } from "@/server/crypto/encryption";
import { dataKey } from "@/server/crypto/keys";
import { insertRows } from "@/server/services/imports/commit";

const owner = "ofx_owner";
const ids = [owner];

async function newAccount(ownerId = owner, initialBalance = 0): Promise<string> {
  const acc = await db.bankAccount.create({
    data: { ownerId, name: "Courant", type: "CHECKING", initialBalance },
  });
  return acc.id;
}

async function cleanup() {
  const accounts = await db.bankAccount.findMany({
    where: { ownerId: { in: ids } },
    select: { id: true },
  });
  const accountIds = accounts.map((a) => a.id);
  await db.transaction.deleteMany({ where: { accountId: { in: accountIds } } });
  await db.importBatch.deleteMany({ where: { accountId: { in: accountIds } } });
  await db.auditLog.deleteMany({ where: { userId: { in: ids } } });
  await db.bankAccount.deleteMany({ where: { ownerId: { in: ids } } });
  await db.user.deleteMany({ where: { id: { in: ids } } });
}

beforeAll(async () => {
  await cleanup();
  for (const id of ids) await db.user.create({ data: { id, email: `${id}@bilan.local` } });
});

afterAll(async () => {
  await cleanup();
  await db.$disconnect();
});

describe("insertRows notes", () => {
  it("stores the note of an imported row, null without one", async () => {
    const accountId = await newAccount();
    const batch = await db.importBatch.create({
      data: { accountId, source: "OFX", status: "REVIEW", createdById: owner },
    });
    await insertRows(
      { batchId: batch.id, accountId },
      [
        {
          date: new Date("2031-01-05T00:00:00.000Z"),
          amount: -12.5,
          rawLabel: "CB NOTE SHOP",
          note: "MEMO TEXT",
        },
        { date: new Date("2031-01-06T00:00:00.000Z"), amount: -3, rawLabel: "CB NO NOTE" },
      ],
      { id: owner },
      { autoCategorize: false },
    );
    const txs = await db.transaction.findMany({ where: { accountId }, orderBy: { date: "asc" } });
    expect(decrypt(txs[0].noteEnc!, dataKey)).toBe("MEMO TEXT");
    expect(txs[1].noteEnc).toBeNull();
  });
});

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "@/server/db";
import { decrypt } from "@/server/crypto/encryption";
import { hmacForSearch } from "@/server/crypto/hmac";
import { dataKey, searchKey } from "@/server/crypto/keys";
import {
  createTransaction,
  getTransactionForUser,
  TransactionAccessError,
} from "@/server/services/transactions";

const owner = "tx_owner";
const stranger = "tx_stranger";
let accountId: string;

beforeAll(async () => {
  await db.user.deleteMany({ where: { id: { in: [owner, stranger] } } });
  await db.user.create({ data: { id: owner, email: "tx-owner@bilan.local" } });
  await db.user.create({ data: { id: stranger, email: "tx-stranger@bilan.local" } });
  const acc = await db.bankAccount.create({
    data: { ownerId: owner, name: "Courant", type: "CHECKING" },
  });
  accountId = acc.id;
});

afterAll(async () => {
  await db.bankAccount.deleteMany({ where: { ownerId: { in: [owner, stranger] } } });
  await db.user.deleteMany({ where: { id: { in: [owner, stranger] } } });
  await db.$disconnect();
});

describe("createTransaction", () => {
  it("creates a transaction, encrypts labels and writes per-word search tokens", async () => {
    const { id } = await createTransaction(
      {
        accountId,
        date: "2026-01-10",
        amount: "-42,90",
        type: "CARD",
        label: "Carrefour City",
        rawLabel: "CB CARREFOUR CITY PARIS",
        note: "courses",
      },
      { id: owner },
    );
    const row = await db.transaction.findUniqueOrThrow({
      where: { id },
      include: { searchTokens: true },
    });
    expect(decrypt(row.labelEnc, dataKey)).toBe("Carrefour City");
    expect(row.labelEnc).not.toContain("Carrefour");
    expect(Number(row.amount)).toBe(-42.9);
    expect(
      row.searchTokens.some((t) => t.tokenHash === hmacForSearch("carrefour", searchKey)),
    ).toBe(true);
    expect(row.searchTokens.some((t) => t.tokenHash === hmacForSearch("paris", searchKey))).toBe(
      true,
    );

    const audit = await db.auditLog.findFirst({
      where: { action: "transaction.created", entityId: id },
    });
    expect(audit).not.toBeNull();
  });

  it("defaults rawLabel to label when omitted", async () => {
    const { id } = await createTransaction(
      { accountId, date: "2026-01-11", amount: 10, type: "OTHER", label: "Remboursement" },
      { id: owner },
    );
    const row = await db.transaction.findUniqueOrThrow({ where: { id } });
    expect(decrypt(row.rawLabelEnc, dataKey)).toBe("Remboursement");
  });

  it("rejects creating a transaction on an account the actor cannot write", async () => {
    await expect(
      createTransaction(
        { accountId, date: "2026-01-12", amount: 5, type: "OTHER", label: "X" },
        { id: stranger },
      ),
    ).rejects.toBeInstanceOf(TransactionAccessError);
  });

  it("getTransactionForUser returns a decrypted view for the owner and null for a stranger", async () => {
    const { id } = await createTransaction(
      { accountId, date: "2026-01-13", amount: -7, type: "CARD", label: "Boulangerie" },
      { id: owner },
    );
    const view = await getTransactionForUser(id, owner);
    expect(view?.label).toBe("Boulangerie");
    expect(await getTransactionForUser(id, stranger)).toBeNull();
  });
});

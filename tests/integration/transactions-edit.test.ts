import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "@/server/db";
import { hmacForSearch } from "@/server/crypto/hmac";
import { searchKey } from "@/server/crypto/keys";
import {
  createTransaction,
  getTransactionForUser,
  listTransactions,
  recategorizeTransaction,
  TransactionAccessError,
  updateTransaction,
} from "@/server/services/transactions";

const owner = "txe_owner";
const reader = "txe_reader";
const writer = "txe_writer";
const stranger = "txe_stranger";
const users = [owner, reader, writer, stranger];
let accountId: string;
let archivedId: string;
let readGroupId: string;
let writeGroupId: string;

async function manual(label: string, accId = accountId) {
  return (
    await createTransaction(
      { accountId: accId, date: "2026-02-01", amount: -10, type: "CARD", label },
      { id: owner },
    )
  ).id;
}

beforeAll(async () => {
  await db.user.deleteMany({ where: { id: { in: users } } });
  for (const id of users) {
    await db.user.create({ data: { id, email: `${id}@bilan.local` } });
  }
  accountId = (
    await db.bankAccount.create({ data: { ownerId: owner, name: "Courant", type: "CHECKING" } })
  ).id;
  archivedId = (
    await db.bankAccount.create({ data: { ownerId: owner, name: "Ancien", type: "CHECKING" } })
  ).id;
  readGroupId = (await db.group.create({ data: { name: "TXE read", createdById: owner } })).id;
  writeGroupId = (await db.group.create({ data: { name: "TXE write", createdById: owner } })).id;
  await db.groupMember.createMany({
    data: [
      { groupId: readGroupId, userId: reader, role: "MEMBER" },
      { groupId: writeGroupId, userId: writer, role: "MEMBER" },
    ],
  });
  await db.accountShare.createMany({
    data: [
      { accountId, groupId: readGroupId, permission: "READ", createdById: owner },
      { accountId, groupId: writeGroupId, permission: "WRITE", createdById: owner },
    ],
  });
});

afterAll(async () => {
  await db.transaction.deleteMany({ where: { accountId: { in: [accountId, archivedId] } } });
  await db.accountShare.deleteMany({ where: { accountId } });
  await db.groupMember.deleteMany({ where: { groupId: { in: [readGroupId, writeGroupId] } } });
  await db.group.deleteMany({ where: { id: { in: [readGroupId, writeGroupId] } } });
  await db.bankAccount.deleteMany({ where: { ownerId: owner } });
  await db.user.deleteMany({ where: { id: { in: users } } });
  await db.$disconnect();
});

describe("updateTransaction", () => {
  it("rewrites every field of a manual row and re-indexes its search tokens", async () => {
    const id = await manual("Boulangerie Paul");
    await updateTransaction(
      id,
      {
        label: "Fromagerie Lucie",
        note: "cadeau",
        date: "2026-03-04",
        amount: "-23,40",
        type: "CHEQUE",
      },
      { id: owner },
    );
    const view = await getTransactionForUser(id, owner);
    expect(view).toMatchObject({
      label: "Fromagerie Lucie",
      rawLabel: "Fromagerie Lucie",
      note: "cadeau",
      amount: -23.4,
      type: "CHEQUE",
    });
    expect(view!.date.toISOString()).toBe("2026-03-04T00:00:00.000Z");

    expect(
      (await listTransactions(owner, { search: "fromagerie" })).items.map((i) => i.id),
    ).toEqual([id]);
    expect((await listTransactions(owner, { search: "boulangerie" })).items).toEqual([]);
    const row = await db.transaction.findUniqueOrThrow({ where: { id } });
    expect(row.labelHash).toBe(hmacForSearch("Fromagerie Lucie", searchKey));

    const audit = await db.auditLog.findFirst({
      where: { action: "transaction.updated", entityId: id },
    });
    expect(audit?.metadata).toEqual({ fields: ["label", "note", "date", "amount", "type"] });
  });

  it("clears the note when it is left blank and keeps omitted fields", async () => {
    const id = await manual("Kiosque");
    await updateTransaction(id, { label: "Kiosque", note: "journal" }, { id: owner });
    await updateTransaction(id, { label: "Kiosque", note: "  " }, { id: owner });
    const view = await getTransactionForUser(id, owner);
    expect(view).toMatchObject({ note: null, amount: -10, type: "CARD" });
  });

  it("limits an imported row to label and note, keeping the bank's raw label", async () => {
    const t = await createTransaction(
      {
        accountId,
        date: "2026-02-02",
        amount: -5,
        type: "CARD",
        label: "CB CARREFOUR 12",
        rawLabel: "CB CARREFOUR 12",
      },
      { id: owner },
      { externalId: "txe-import-1" },
    );
    const before = await db.transaction.findUniqueOrThrow({ where: { id: t.id } });
    await updateTransaction(t.id, { label: "Carrefour", note: "courses" }, { id: owner });
    expect(await getTransactionForUser(t.id, owner)).toMatchObject({
      label: "Carrefour",
      rawLabel: "CB CARREFOUR 12",
      note: "courses",
    });
    const after = await db.transaction.findUniqueOrThrow({ where: { id: t.id } });
    expect(after.externalId).toBe("txe-import-1");
    expect(after.rawLabelHash).toBe(before.rawLabelHash);
    await expect(
      updateTransaction(t.id, { label: "Carrefour", amount: "-6" }, { id: owner }),
    ).rejects.toThrow("LOCKED_FIELDS");
  });

  it("limits a row on an archived account to label and note", async () => {
    const id = await manual("Ancien loyer", archivedId);
    await db.bankAccount.update({ where: { id: archivedId }, data: { archived: true } });
    await updateTransaction(id, { label: "Loyer 2025" }, { id: owner });
    await expect(
      updateTransaction(id, { label: "Loyer 2025", date: "2026-01-01" }, { id: owner }),
    ).rejects.toThrow("LOCKED_FIELDS");
    await db.bankAccount.update({ where: { id: archivedId }, data: { archived: false } });
  });

  it("requires WRITE access on the account", async () => {
    const id = await manual("Partagé");
    await expect(updateTransaction(id, { label: "Lu" }, { id: reader })).rejects.toBeInstanceOf(
      TransactionAccessError,
    );
    await updateTransaction(id, { label: "Écrit" }, { id: writer });
    expect((await getTransactionForUser(id, owner))?.label).toBe("Écrit");
  });

  it("rejects a user with no share on the account", async () => {
    const id = await manual("Privé");
    await expect(updateTransaction(id, { label: "Volé" }, { id: stranger })).rejects.toThrow(
      "FORBIDDEN",
    );
  });

  it("keeps a manual row's raw label when it already differed from its label", async () => {
    const t = await createTransaction(
      {
        accountId,
        date: "2026-02-03",
        amount: -7,
        type: "CARD",
        label: "Pharmacie",
        rawLabel: "PHIE DU CENTRE",
      },
      { id: owner },
    );
    await updateTransaction(t.id, { label: "Pharmacie centre" }, { id: owner });
    expect((await getTransactionForUser(t.id, owner))?.rawLabel).toBe("PHIE DU CENTRE");
  });

  it("re-runs the rules on a rule-categorized row whose label changes, not a manual pick", async () => {
    const food = await db.category.create({ data: { name: "Alimentation", userId: owner } });
    const rule = await db.categorizationRule.create({
      data: { pattern: "biocoop", matchType: "CONTAINS", categoryId: food.id, userId: owner },
    });
    const auto = await manual("Epicerie");
    await updateTransaction(auto, { label: "Biocoop Nantes" }, { id: owner });
    expect(await db.transaction.findUniqueOrThrow({ where: { id: auto } })).toMatchObject({
      categoryId: food.id,
      manuallyCategorized: false,
    });
    expect((await db.categorizationRule.findUniqueOrThrow({ where: { id: rule.id } })).hits).toBe(
      1,
    );
    // The rule no longer matches: the rule-assigned category goes too.
    await updateTransaction(auto, { label: "Marché" }, { id: owner });
    expect((await db.transaction.findUniqueOrThrow({ where: { id: auto } })).categoryId).toBeNull();

    const picked = await manual("Epicerie fine");
    await recategorizeTransaction(picked, null, { id: owner });
    await updateTransaction(picked, { label: "Biocoop Rezé" }, { id: owner });
    expect(
      (await db.transaction.findUniqueOrThrow({ where: { id: picked } })).categoryId,
    ).toBeNull();

    await db.transaction.deleteMany({ where: { id: { in: [auto, picked] } } });
    await db.category.delete({ where: { id: food.id } });
  });

  it("rejects an unknown id, a zero amount and an impossible day", async () => {
    await expect(updateTransaction("nope", { label: "x" }, { id: owner })).rejects.toThrow(
      "NOT_FOUND",
    );
    const id = await manual("Validation");
    await expect(
      updateTransaction(id, { label: "x", amount: "0" }, { id: owner }),
    ).rejects.toThrow();
    await expect(
      updateTransaction(id, { label: "x", date: "2026-02-30" }, { id: owner }),
    ).rejects.toThrow();
  });
});

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { decrypt } from "@/server/crypto/encryption";
import { dataKey } from "@/server/crypto/keys";
import { LinkAccessError } from "@/server/services/links";
import { createOppositeTransaction } from "@/server/services/links/opposite";
import { setManualMonth } from "@/server/services/links/month";
import { buildSecureFields } from "@/server/services/transactions/secure-fields";

const owner = "opposite_owner";
const writer = "opposite_writer"; // WRITE share on the owner's current account
const reader = "opposite_reader"; // READ share on it
const stranger = "opposite_stranger";
const users = [owner, writer, reader, stranger];
const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
let courant: string;
let livret: string;
let archived: string;
let writerAccount: string;
let strangerAccount: string;
let groupIds: string[];

const account = (ownerId: string, name: string, type: string, isArchived = false) =>
  db.bankAccount.create({ data: { ownerId, name, type, archived: isArchived } }).then((a) => a.id);

async function tx(accountId: string, amount: number, type = "TRANSFER"): Promise<string> {
  const s = buildSecureFields({ label: "VIREMENT TEST", rawLabel: "VIREMENT TEST" });
  const row = await db.transaction.create({
    data: {
      accountId,
      date: day("2026-10-10"),
      amount,
      type,
      labelEnc: s.labelEnc,
      labelHash: s.labelHash,
      rawLabelEnc: s.rawLabelEnc,
      rawLabelHash: s.rawLabelHash,
      createdById: owner,
    },
  });
  return row.id;
}

const legOf = (id: string) =>
  db.transaction.findUniqueOrThrow({
    where: { id },
    include: { linkMembership: { include: { link: { include: { members: true } } } } },
  });

const refusal = (p: Promise<unknown>, code: string) =>
  expect(p).rejects.toThrowError(new LinkAccessError(code));

beforeAll(async () => {
  await db.user.deleteMany({ where: { id: { in: users } } });
  for (const id of users) await db.user.create({ data: { id, email: `${id}@bilan.local` } });
  courant = await account(owner, "Courant", "CHECKING");
  livret = await account(owner, "Livret A", "SAVINGS");
  archived = await account(owner, "Ancien", "SAVINGS", true);
  writerAccount = await account(writer, "Compte du writer", "CHECKING");
  strangerAccount = await account(stranger, "Autre", "SAVINGS");
  groupIds = [];
  for (const [member, permission] of [
    [writer, "WRITE"],
    [reader, "READ"],
  ] as const) {
    const group = await db.group.create({ data: { name: `Grp ${member}`, createdById: owner } });
    groupIds.push(group.id);
    await db.groupMember.create({ data: { groupId: group.id, userId: member, role: "MEMBER" } });
    await db.accountShare.create({
      data: { accountId: courant, groupId: group.id, permission, createdById: owner },
    });
  }
});

beforeEach(async () => {
  const accounts = [courant, livret, archived, writerAccount, strangerAccount];
  await db.transactionLink.deleteMany({
    where: { members: { some: { transaction: { accountId: { in: accounts } } } } },
  });
  await db.transaction.deleteMany({ where: { accountId: { in: accounts } } });
  await db.auditLog.deleteMany({ where: { userId: { in: users } } });
});

afterAll(async () => {
  await db.auditLog.deleteMany({ where: { userId: { in: users } } });
  await db.accountShare.deleteMany({ where: { groupId: { in: groupIds } } });
  await db.groupMember.deleteMany({ where: { groupId: { in: groupIds } } });
  await db.group.deleteMany({ where: { id: { in: groupIds } } });
  await db.user.deleteMany({ where: { id: { in: users } } });
  await db.$disconnect();
});

describe("createOppositeTransaction", () => {
  it("creates the opposite transfer on the target, linked to the source", async () => {
    const source = await tx(courant, -250);
    const { id, linkId } = await createOppositeTransaction({
      transactionId: source,
      targetAccountId: livret,
      userId: owner,
    });
    const leg = await legOf(id);
    expect(leg).toMatchObject({
      accountId: livret,
      date: day("2026-10-10"),
      type: "TRANSFER",
      categoryId: null,
      externalId: null,
      createdById: owner,
    });
    expect(Number(leg.amount)).toBe(250);
    expect(decrypt(leg.labelEnc, dataKey)).toBe("Virement depuis Courant");
    expect(decrypt(leg.rawLabelEnc, dataKey)).toBe("Virement depuis Courant");
    expect(await db.transactionSearchToken.count({ where: { transactionId: id } })).toBeGreaterThan(
      0,
    );
    expect(leg.linkMembership?.linkId).toBe(linkId);
    expect(leg.linkMembership?.link.auto).toBe(false);
    expect(leg.linkMembership?.link.members.map((m) => m.transactionId).sort()).toEqual(
      [source, id].sort(),
    );
    const audit = await db.auditLog.findFirstOrThrow({
      where: { action: "link.oppositeCreated", entityId: id },
    });
    expect(audit).toMatchObject({ userId: owner, metadata: { sourceId: source, linkId } });
  });

  it("an incoming transfer takes the money out of the target", async () => {
    const source = await tx(courant, 80, "INCOME");
    const { id } = await createOppositeTransaction({
      transactionId: source,
      targetAccountId: livret,
      userId: owner,
    });
    const leg = await legOf(id);
    expect(Number(leg.amount)).toBe(-80);
    expect(decrypt(leg.labelEnc, dataKey)).toBe("Virement vers Courant");
  });

  it("the new leg takes the source's manual month", async () => {
    const source = await tx(courant, -100);
    await setManualMonth([{ id: source, date: day("2026-10-10") }], { year: 2026, month: 9 });
    const { id } = await createOppositeTransaction({
      transactionId: source,
      targetAccountId: livret,
      userId: owner,
    });
    const leg = await legOf(id);
    expect(leg.periodManual).toBe(true);
    expect(leg.periodDate.getUTCMonth() + 1).toBe(9);
  });

  it("a member with write access targets their own accounts only", async () => {
    const source = await tx(courant, -40);
    await refusal(
      createOppositeTransaction({ transactionId: source, targetAccountId: livret, userId: writer }),
      "TARGET_FORBIDDEN",
    );
    const { id } = await createOppositeTransaction({
      transactionId: source,
      targetAccountId: writerAccount,
      userId: writer,
    });
    expect((await legOf(id)).accountId).toBe(writerAccount);
  });

  it("refuses a source the user can't edit or see", async () => {
    const source = await tx(courant, -40);
    await refusal(
      createOppositeTransaction({
        transactionId: source,
        targetAccountId: strangerAccount,
        userId: reader,
      }),
      "FORBIDDEN",
    );
    await refusal(
      createOppositeTransaction({
        transactionId: source,
        targetAccountId: strangerAccount,
        userId: stranger,
      }),
      "NOT_FOUND",
    );
    await refusal(
      createOppositeTransaction({
        transactionId: "missing",
        targetAccountId: livret,
        userId: owner,
      }),
      "NOT_FOUND",
    );
  });

  it("refuses the same, a foreign, a missing or an archived target", async () => {
    const source = await tx(courant, -40);
    const attempt = (targetAccountId: string) =>
      createOppositeTransaction({ transactionId: source, targetAccountId, userId: owner });
    await refusal(attempt(courant), "SAME_ACCOUNT");
    await refusal(attempt(strangerAccount), "TARGET_FORBIDDEN");
    await refusal(attempt("missing"), "TARGET_FORBIDDEN");
    await refusal(attempt(archived), "TARGET_ARCHIVED");
    const targets = [livret, archived, strangerAccount];
    expect(await db.transaction.count({ where: { accountId: { in: targets } } })).toBe(0);
  });

  it("refuses an already linked source, also when two requests race", async () => {
    const source = await tx(courant, -60);
    const attempt = () =>
      createOppositeTransaction({ transactionId: source, targetAccountId: livret, userId: owner });
    const results = await Promise.allSettled([attempt(), attempt()]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((r) => r.status === "rejected");
    expect(rejected?.reason).toEqual(new LinkAccessError("ALREADY_LINKED"));
    expect(await db.transaction.count({ where: { accountId: livret } })).toBe(1);
    await refusal(attempt(), "ALREADY_LINKED");
  });
});

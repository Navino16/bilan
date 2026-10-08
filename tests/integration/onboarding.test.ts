import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "@/server/db";
import { createTransaction } from "@/server/services/transactions";
import { getOnboardingState } from "@/server/services/onboarding";

const fresh = "onb_fresh";
const owner = "onb_owner";
const reader = "onb_reader";
const writer = "onb_writer";
const archivist = "onb_archivist";
const mixed = "onb_mixed";
const staleWriter = "onb_stale_writer";
const ids = [fresh, owner, reader, writer, archivist, mixed, staleWriter];

async function cleanup() {
  await db.group.deleteMany({ where: { createdById: { in: ids } } });
  await db.bankAccount.deleteMany({ where: { ownerId: { in: ids } } });
  await db.user.deleteMany({ where: { id: { in: ids } } });
}

let ownerAccountId: string;

beforeAll(async () => {
  await cleanup();
  for (const id of ids) await db.user.create({ data: { id, email: `${id}@bilan.local` } });

  const acc = await db.bankAccount.create({
    data: { ownerId: owner, name: "Courant", type: "CHECKING" },
  });
  ownerAccountId = acc.id;
  const archivedShared = await db.bankAccount.create({
    data: { ownerId: owner, name: "Ancien", type: "CHECKING", archived: true },
  });
  const readGroup = await db.group.create({ data: { name: "Read", createdById: owner } });
  const writeGroup = await db.group.create({ data: { name: "Write", createdById: owner } });
  const staleGroup = await db.group.create({ data: { name: "Stale", createdById: owner } });
  await db.groupMember.createMany({
    data: [
      { groupId: readGroup.id, userId: owner, role: "OWNER" },
      { groupId: readGroup.id, userId: reader, role: "MEMBER" },
      { groupId: writeGroup.id, userId: owner, role: "OWNER" },
      { groupId: writeGroup.id, userId: writer, role: "MEMBER" },
      { groupId: writeGroup.id, userId: mixed, role: "MEMBER" },
      { groupId: staleGroup.id, userId: owner, role: "OWNER" },
      { groupId: staleGroup.id, userId: staleWriter, role: "MEMBER" },
    ],
  });
  await db.accountShare.createMany({
    data: [
      { accountId: acc.id, groupId: readGroup.id, permission: "READ", createdById: owner },
      { accountId: acc.id, groupId: writeGroup.id, permission: "WRITE", createdById: owner },
      {
        accountId: archivedShared.id,
        groupId: staleGroup.id,
        permission: "WRITE",
        createdById: owner,
      },
    ],
  });

  for (const ownerId of [archivist, mixed])
    await db.bankAccount.create({
      data: { ownerId, name: "Old", type: "CHECKING", archived: true },
    });
});

afterAll(async () => {
  await cleanup();
  await db.$disconnect();
});

describe("getOnboardingState", () => {
  it("flags a brand-new user as having no account and no transaction", async () => {
    expect(await getOnboardingState(fresh)).toEqual({
      hasTransaction: false,
      addBlocker: "NO_ACCOUNT",
    });
  });

  it("owner of an empty account can add a transaction but has none yet", async () => {
    expect(await getOnboardingState(owner)).toEqual({ hasTransaction: false, addBlocker: null });
  });

  it("a READ share is visible but not writable", async () => {
    expect((await getOnboardingState(reader)).addBlocker).toBe("READ_ONLY");
  });

  it("a WRITE share lets the member add transactions", async () => {
    expect((await getOnboardingState(writer)).addBlocker).toBeNull();
  });

  it("only archived owned accounts block adding", async () => {
    expect((await getOnboardingState(archivist)).addBlocker).toBe("ARCHIVED");
  });

  it("an active WRITE share wins over an archived owned account", async () => {
    expect((await getOnboardingState(mixed)).addBlocker).toBeNull();
  });

  it("an archived WRITE share is the only writable account → ARCHIVED", async () => {
    expect((await getOnboardingState(staleWriter)).addBlocker).toBe("ARCHIVED");
  });

  it("sees transactions on owned and shared accounts alike", async () => {
    await createTransaction(
      {
        accountId: ownerAccountId,
        date: "2026-01-10",
        amount: "-12,50",
        type: "CARD",
        label: "Café",
      },
      { id: owner },
    );
    expect((await getOnboardingState(owner)).hasTransaction).toBe(true);
    expect((await getOnboardingState(reader)).hasTransaction).toBe(true);
    expect((await getOnboardingState(fresh)).hasTransaction).toBe(false);
  });
});

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "@/server/db";
import { createAccount } from "@/server/services/accounts";
import { createGroup } from "@/server/services/groups";
import {
  canWriteAccount,
  shareAccountWithGroup,
  writableAccountIds,
} from "@/server/services/accounts/sharing";

const ownerId = "aw_owner";
const memberId = "aw_member";
const ids = [ownerId, memberId];

async function cleanup() {
  await db.accountShare.deleteMany({ where: { account: { ownerId: { in: ids } } } });
  await db.groupMember.deleteMany({ where: { userId: { in: ids } } });
  await db.group.deleteMany({ where: { name: "aw_group" } });
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

describe("writableAccountIds", () => {
  it("lists owned and WRITE-shared accounts, archived ones included, never READ shares", async () => {
    const grp = await createGroup({ name: "aw_group" }, ownerId);
    await db.groupMember.create({ data: { groupId: grp.id, userId: memberId, role: "MEMBER" } });
    const own = await createAccount({ name: "A own", type: "CHECKING" }, memberId);
    const write = await createAccount({ name: "B write", type: "CHECKING" }, ownerId);
    const read = await createAccount({ name: "C read", type: "CHECKING" }, ownerId);
    const archived = await createAccount({ name: "D archived", type: "CHECKING" }, ownerId);
    const unshared = await createAccount({ name: "E unshared", type: "CHECKING" }, ownerId);
    const share = (accountId: string, permission: "READ" | "WRITE") =>
      shareAccountWithGroup({ accountId, groupId: grp.id, permission }, { id: ownerId });
    await share(write.id, "WRITE");
    await share(read.id, "READ");
    await share(archived.id, "WRITE");
    await db.bankAccount.update({ where: { id: archived.id }, data: { archived: true } });

    const writable = await writableAccountIds(memberId);
    expect([...writable].sort()).toEqual([own.id, write.id, archived.id].sort());
    for (const acc of [own, write, read, archived, unshared]) {
      expect(await canWriteAccount(memberId, acc.id), acc.id).toBe(writable.includes(acc.id));
    }
  });
});

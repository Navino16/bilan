import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "@/server/db";
import {
  createGroup,
  listGroupsForUser,
  getGroupDetail,
  updateGroup,
  deleteGroup,
  changeMemberRole,
  removeMember,
  leaveGroup,
} from "@/server/services/groups";
import { GroupAccessError } from "@/server/services/groups/roles";

const owner = "grp_owner";
const admin = "grp_admin";
const member = "grp_member";
const ids = [owner, admin, member];

beforeAll(async () => {
  await db.groupMember.deleteMany({ where: { userId: { in: ids } } });
  await db.user.deleteMany({ where: { id: { in: ids } } });
  for (const id of ids) await db.user.create({ data: { id, email: `${id}@bilan.local` } });
});

afterAll(async () => {
  await db.groupMember.deleteMany({ where: { userId: { in: ids } } });
  await db.user.deleteMany({ where: { id: { in: ids } } });
  await db.$disconnect();
});

describe("groups service", () => {
  it("creates a group with the creator as sole OWNER + audit", async () => {
    const g = await createGroup({ name: "Foyer" }, owner);
    const detail = await getGroupDetail(g.id, owner);
    expect(detail.members).toHaveLength(1);
    expect(detail.members[0]).toMatchObject({ userId: owner, role: "OWNER" });
    expect(
      await db.auditLog.findFirst({ where: { action: "group.created", entityId: g.id } }),
    ).not.toBeNull();
  });

  it("lists only groups the user belongs to, with their role", async () => {
    const g = await createGroup({ name: "Mine" }, owner);
    expect((await listGroupsForUser(owner)).some((x) => x.id === g.id && x.role === "OWNER")).toBe(
      true,
    );
    expect((await listGroupsForUser(member)).some((x) => x.id === g.id)).toBe(false);
  });

  it("enforces role rules", async () => {
    const g = await createGroup({ name: "Rules" }, owner);
    // seed an ADMIN and a MEMBER directly
    await db.groupMember.create({ data: { groupId: g.id, userId: admin, role: "ADMIN" } });
    await db.groupMember.create({ data: { groupId: g.id, userId: member, role: "MEMBER" } });

    // MEMBER cannot rename
    await expect(updateGroup(g.id, { name: "x" }, { id: member })).rejects.toBeInstanceOf(
      GroupAccessError,
    );
    // ADMIN can rename
    await updateGroup(g.id, { name: "Renamed" }, { id: admin });
    // ADMIN cannot delete; OWNER can
    await expect(deleteGroup(g.id, { id: admin })).rejects.toBeInstanceOf(GroupAccessError);
    // only OWNER changes roles
    await expect(changeMemberRole(g.id, member, "ADMIN", { id: admin })).rejects.toBeInstanceOf(
      GroupAccessError,
    );
    await changeMemberRole(g.id, member, "ADMIN", { id: owner });
    expect((await getGroupDetail(g.id, owner)).members.find((m) => m.userId === member)?.role).toBe(
      "ADMIN",
    );
  });

  it("prevents removing/demoting the last OWNER", async () => {
    const g = await createGroup({ name: "Solo" }, owner);
    await expect(changeMemberRole(g.id, owner, "ADMIN", { id: owner })).rejects.toBeInstanceOf(
      GroupAccessError,
    );
    await expect(leaveGroup(g.id, owner)).rejects.toBeInstanceOf(GroupAccessError);
    await expect(removeMember(g.id, owner, { id: owner })).rejects.toBeInstanceOf(GroupAccessError);
  });

  it("an ADMIN can only remove members ranked below them", async () => {
    const g = await createGroup({ name: "Ranks" }, owner);
    await db.groupMember.create({ data: { groupId: g.id, userId: admin, role: "ADMIN" } });
    await db.groupMember.create({ data: { groupId: g.id, userId: member, role: "MEMBER" } });

    // ADMIN cannot remove an OWNER (even though another owner would remain — here
    // the owner is the last one, so this also guards the rank check, not just the
    // last-owner check).
    await expect(removeMember(g.id, owner, { id: admin })).rejects.toBeInstanceOf(GroupAccessError);

    // ADMIN cannot remove a peer ADMIN.
    const admin2 = await db.user.create({
      data: { id: "grp_admin2", email: "grp_admin2@b.local" },
    });
    await db.groupMember.create({ data: { groupId: g.id, userId: admin2.id, role: "ADMIN" } });
    await expect(removeMember(g.id, admin2.id, { id: admin })).rejects.toBeInstanceOf(
      GroupAccessError,
    );

    // ADMIN can remove a MEMBER.
    await removeMember(g.id, member, { id: admin });
    expect((await getGroupDetail(g.id, owner)).members.some((m) => m.userId === member)).toBe(
      false,
    );

    // OWNER can remove an ADMIN.
    await removeMember(g.id, admin, { id: owner });
    expect((await getGroupDetail(g.id, owner)).members.some((m) => m.userId === admin)).toBe(false);

    await db.groupMember.deleteMany({ where: { userId: admin2.id } });
    await db.user.delete({ where: { id: admin2.id } });
  });

  it("lets a MEMBER leave, and an OWNER delete the group", async () => {
    const g = await createGroup({ name: "Leaveable" }, owner);
    await db.groupMember.create({ data: { groupId: g.id, userId: member, role: "MEMBER" } });
    await leaveGroup(g.id, member);
    expect((await getGroupDetail(g.id, owner)).members.some((m) => m.userId === member)).toBe(
      false,
    );
    await deleteGroup(g.id, { id: owner });
    expect(await db.group.findUnique({ where: { id: g.id } })).toBeNull();
  });
});

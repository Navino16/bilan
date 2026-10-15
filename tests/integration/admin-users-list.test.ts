import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "@/server/db";
import { listUsersForAdmin } from "@/server/services/users/admin-list";

const ids = ["adminlist_1", "adminlist_2", "adminlist_3"];
const roleKey = "ADMINLIST_TEST_ROLE";

beforeAll(async () => {
  await db.user.deleteMany({ where: { id: { in: ids } } });
  await db.role.deleteMany({ where: { key: roleKey } });
  const role = await db.role.create({ data: { key: roleKey, name: "Admin list test" } });
  await db.user.createMany({
    data: ids.map((id, i) => ({
      id,
      email: `adminlist-${i}@bilan.local`,
      name: i === 2 ? "Zoé Adminlist" : null,
      createdAt: new Date(Date.UTC(2020, 0, i + 1)),
    })),
  });
  await db.userRole.create({ data: { userId: ids[0], roleId: role.id } });
});

afterAll(async () => {
  await db.user.deleteMany({ where: { id: { in: ids } } });
  await db.role.deleteMany({ where: { key: roleKey } });
  await db.$disconnect();
});

describe("listUsersForAdmin", () => {
  it("searches email and name case-insensitively, newest first, with role keys", async () => {
    const res = await listUsersForAdmin({ q: "ADMINLIST" });
    expect(res.total).toBe(3);
    expect(res.items.map((u) => u.id)).toEqual(["adminlist_3", "adminlist_2", "adminlist_1"]);
    expect(res.items[2].roleKeys).toEqual([roleKey]);
    const byName = await listUsersForAdmin({ q: "zoé" });
    expect(byName.items.map((u) => u.id)).toEqual(["adminlist_3"]);
  });

  it("treats LIKE wildcards in the search as literal characters (#223)", async () => {
    expect((await listUsersForAdmin({ q: "adminlist_0" })).total).toBe(0);
    expect((await listUsersForAdmin({ q: "adminlist%0" })).total).toBe(0);
    expect((await listUsersForAdmin({ q: "adminlist\\" })).total).toBe(0);
    expect((await listUsersForAdmin({ q: "adminlist-0" })).total).toBe(1);

    const id = "likeesc_223";
    await db.user.deleteMany({ where: { id } });
    await db.user.create({ data: { id, email: "likeesc_x%y@bilan.local" } });
    try {
      expect((await listUsersForAdmin({ q: "esc_x" })).items.map((u) => u.id)).toEqual([id]);
      expect((await listUsersForAdmin({ q: "x%y" })).items.map((u) => u.id)).toEqual([id]);
      expect((await listUsersForAdmin({ q: "esc-x" })).total).toBe(0);
    } finally {
      await db.user.deleteMany({ where: { id } });
    }
  });

  it("paginates and clamps", async () => {
    const res = await listUsersForAdmin({ q: "adminlist", page: 2, pageSize: 2 });
    expect(res).toMatchObject({ total: 3, page: 2, pageCount: 2 });
    expect(res.items.map((u) => u.id)).toEqual(["adminlist_1"]);
    const past = await listUsersForAdmin({ q: "adminlist", page: 9, pageSize: 2 });
    expect(past.page).toBe(2);
  });
});

import { describe, it, expect, afterAll } from "vitest";
import { db } from "@/server/db";
import { getAuth } from "@/server/auth";

const stamp = Date.now();
const emails = [`blank-name+${stamp}@bilan.local`, `trim-name+${stamp}@bilan.local`];

afterAll(async () => {
  await db.user.deleteMany({ where: { email: { in: emails } } });
  await db.$disconnect();
});

describe("Better Auth user name hooks (#163)", () => {
  it("stores the email as the name when an account is created with a blank name", async () => {
    const ctx = await (await getAuth()).$context;
    const user = await ctx.internalAdapter.createUser(
      {
        email: emails[0],
        name: "   ",
        emailVerified: false,
      },
      { method: "email-password" },
    );
    expect((await db.user.findUnique({ where: { id: user.id } }))?.name).toBe(emails[0]);
  });

  it("trims names on update and refuses a blank one", async () => {
    const ctx = await (await getAuth()).$context;
    const user = await ctx.internalAdapter.createUser(
      {
        email: emails[1],
        name: "  Ann  ",
        emailVerified: false,
      },
      { method: "email-password" },
    );
    expect((await db.user.findUnique({ where: { id: user.id } }))?.name).toBe("Ann");

    await ctx.internalAdapter.updateUser(user.id, { name: " Bob " });
    expect((await db.user.findUnique({ where: { id: user.id } }))?.name).toBe("Bob");

    await expect(ctx.internalAdapter.updateUser(user.id, { name: "   " })).rejects.toThrow();
    expect((await db.user.findUnique({ where: { id: user.id } }))?.name).toBe("Bob");
  });
});

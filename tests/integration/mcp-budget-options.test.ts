import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "@/server/db";
import { listBudgetAccountOptions } from "@/server/services/budgets";
import { runAsMcp } from "@/server/mcp/context";
import {
  cleanupMcpFixture,
  createMcpFixture,
  mcpPrincipal,
  type McpFixture,
} from "./support/mcp-fixtures";

const PREFIX = "mcpbudopt";
let f: McpFixture;
let g2 = "";

// `shared-ai` is also shared with a second household G2, there without the AI flag, as is
// member B's own account.
beforeAll(async () => {
  f = await createMcpFixture(PREFIX, new Date("2026-06-15T12:00:00.000Z"));
  g2 = (await db.group.create({ data: { name: `${PREFIX} G2`, createdById: f.ownerId } })).id;
  await db.groupMember.createMany({
    data: [
      { groupId: g2, userId: f.ownerId, role: "OWNER" },
      { groupId: g2, userId: f.memberId, role: "MEMBER" },
    ],
  });
  await db.accountShare.createMany({
    data: [
      { accountId: f.accounts.sharedAi, groupId: g2, permission: "READ", createdById: f.ownerId },
      { accountId: f.accounts.own, groupId: g2, permission: "READ", createdById: f.memberId },
    ],
  });
});

afterAll(async () => {
  await cleanupMcpFixture(PREFIX);
  await db.$disconnect();
});

const groupsByAccount = (options: { id: string; groupIds: string[] }[]) =>
  Object.fromEntries(options.map((o) => [o.id, [...o.groupIds].sort()]));

describe("listBudgetAccountOptions", () => {
  it("lists every group an account is shared with outside an MCP call", async () => {
    expect(groupsByAccount(await listBudgetAccountOptions(f.memberId))).toEqual({
      [f.accounts.sharedAi]: [f.groupId, g2].sort(),
      [f.accounts.sharedPlain]: [f.groupId],
      [f.accounts.own]: [g2],
    });
  });

  // An account AI-allowed in one household is visible to the assistant in every one (spec §5.18).
  it("inside an MCP call keeps the assistant's accounts with all their groups", async () => {
    const options = await runAsMcp(mcpPrincipal(f.memberId), () =>
      listBudgetAccountOptions(f.memberId),
    );
    expect(groupsByAccount(options)).toEqual({
      [f.accounts.sharedAi]: [f.groupId, g2].sort(),
      [f.accounts.own]: [g2],
    });
  });
});

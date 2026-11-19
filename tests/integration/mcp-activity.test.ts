import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { db } from "@/server/db";
import { logEvent } from "@/server/services/audit";
import { runAsMcp, type McpPrincipal } from "@/server/mcp/context";
import { listMcpActivity } from "@/server/mcp/activity";

const userId = "mcpactivity_user";
const otherId = "mcpactivity_other";
const now = new Date("2026-11-19T12:00:00Z");
const DAY = 86_400_000;

const principal = (uid: string, name: string): McpPrincipal => ({
  userId: uid,
  scopes: ["bilan:read", "bilan:write"],
  client: { kind: "oauth", id: `client_${name}`, name },
});

const mcpRow = (uid: string, action: string, createdAt: Date, name = "Claude") =>
  db.auditLog.create({
    data: {
      userId: uid,
      action,
      entity: "Transaction",
      entityId: `tx_${action}`,
      metadata: { via: "mcp", client: principal(uid, name).client, by: uid },
      createdAt,
    },
  });

beforeEach(async () => {
  await db.auditLog.deleteMany({ where: { userId: { in: [userId, otherId] } } });
  await db.user.deleteMany({ where: { id: { in: [userId, otherId] } } });
  await db.user.createMany({
    data: [
      { id: userId, email: `${userId}@bilan.local`, name: "U" },
      { id: otherId, email: `${otherId}@bilan.local`, name: "O" },
    ],
  });
});

afterAll(async () => {
  await db.auditLog.deleteMany({ where: { userId: { in: [userId, otherId] } } });
  await db.user.deleteMany({ where: { id: { in: [userId, otherId] } } });
  await db.$disconnect();
});

describe("listMcpActivity", () => {
  it("lists the rows written inside runAsMcp with their client name, not the others", async () => {
    await runAsMcp(principal(userId, "Claude Code"), () =>
      logEvent({
        userId,
        action: "transaction.recategorize",
        entity: "Transaction",
        entityId: "tx1",
      }),
    );
    await logEvent({
      userId,
      action: "transaction.update",
      entity: "Transaction",
      entityId: "tx2",
    });

    const rows = await listMcpActivity(userId);
    expect(rows).toEqual([
      {
        id: expect.any(String),
        at: expect.any(Date),
        clientName: "Claude Code",
        action: "transaction.recategorize",
        entity: "Transaction",
        entityId: "tx1",
      },
    ]);
  });

  it("leaves out another user's MCP rows", async () => {
    await mcpRow(otherId, "budget.create", new Date(now.getTime() - DAY));
    expect(await listMcpActivity(userId, now)).toEqual([]);
  });

  it("leaves out a row about the user written by another user's call", async () => {
    await runAsMcp(principal(otherId, "Other"), () =>
      logEvent({ userId, action: "link.autoCreated", entity: "User", entityId: userId }),
    );
    expect(await listMcpActivity(userId)).toEqual([]);
  });

  it("keeps the MCP stamp over a caller's own via or client", async () => {
    await runAsMcp(principal(userId, "Claude"), () =>
      logEvent({ userId, action: "auth.signup", metadata: { via: "setup", client: "x", n: 1 } }),
    );
    const row = await db.auditLog.findFirstOrThrow({ where: { userId, action: "auth.signup" } });
    expect(row.metadata).toEqual({
      n: 1,
      via: "mcp",
      client: principal(userId, "Claude").client,
      by: userId,
    });
  });

  it("keeps the last 90 days only", async () => {
    await mcpRow(userId, "budget.create", new Date(now.getTime() - 89 * DAY));
    await mcpRow(userId, "budget.update", new Date(now.getTime() - 91 * DAY));
    const rows = await listMcpActivity(userId, now);
    expect(rows.map((r) => r.action)).toEqual(["budget.create"]);
  });

  it("returns the 50 newest rows, newest first", async () => {
    await db.auditLog.createMany({
      data: Array.from({ length: 60 }, (_, i) => ({
        userId,
        action: `link.create.${i}`,
        metadata: { via: "mcp", client: principal(userId, "Claude").client, by: userId },
        createdAt: new Date(now.getTime() - (i + 1) * 60_000),
      })),
    });
    const rows = await listMcpActivity(userId, now);
    expect(rows).toHaveLength(50);
    expect(rows[0].action).toBe("link.create.0");
    expect(rows[49].action).toBe("link.create.49");
    expect(rows.every((r) => r.clientName === "Claude")).toBe(true);
  });
});

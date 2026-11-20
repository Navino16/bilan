import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { db } from "@/server/db";
import { logEvent } from "@/server/services/audit";
import { runAsMcp, type McpPrincipal } from "@/server/mcp/context";
import { listMcpActivity } from "@/server/mcp/activity";
import { buildSecureFields } from "@/server/services/transactions/secure-fields";
import { cleanupMcpFixture, createMcpFixture, type McpFixture } from "./support/mcp-fixtures";

const userId = "mcpactivity_user";
const otherId = "mcpactivity_other";
const now = new Date("2026-11-19T12:00:00Z");
const DAY = 86_400_000;
const PREFIX = "mcpacttarget";

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
  await cleanupMcpFixture(PREFIX);
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
        target: null,
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

describe("listMcpActivity targets", () => {
  let fx: McpFixture;
  let actor: string;
  let at: number;

  const tx = async (accountId: string, label: string) => {
    const { tokens, ...fields } = buildSecureFields({ label, rawLabel: label.toUpperCase() });
    void tokens;
    const day = new Date("2026-11-10T12:00:00Z");
    return (
      await db.transaction.create({
        data: { accountId, date: day, periodDate: day, amount: -5, type: "CARD", ...fields },
      })
    ).id;
  };
  const link = async (txIds: string[]) => {
    const created = await db.transactionLink.create({ data: { createdById: actor } });
    await db.transactionLinkMember.createMany({
      data: txIds.map((transactionId, i) => ({
        linkId: created.id,
        transactionId,
        joinedAt: new Date(now.getTime() - DAY + i * 1000),
      })),
    });
    return created.id;
  };
  const budget = async (name: string, owner: { userId: string } | { groupId: string }) =>
    (
      await db.budget.create({
        data: {
          name,
          ...owner,
          periodType: "MONTH",
          periodStart: new Date("2026-11-01T00:00:00Z"),
          periodEnd: new Date("2026-11-30T23:59:59Z"),
          createdById: actor,
        },
      })
    ).id;
  const row = async (
    action: string,
    entity: string,
    entityId: string,
    metadata: Record<string, unknown> = {},
  ) => {
    at += 1000;
    return (
      await db.auditLog.create({
        data: {
          userId: actor,
          action,
          entity,
          entityId,
          metadata: {
            ...metadata,
            via: "mcp",
            client: principal(actor, "Claude").client,
            by: actor,
          },
          createdAt: new Date(at),
        },
      })
    ).id;
  };
  const targets = async () =>
    new Map((await listMcpActivity(actor, now)).map((r) => [r.id, r.target]));

  beforeEach(async () => {
    fx = await createMcpFixture(PREFIX, now);
    actor = fx.memberId;
    at = now.getTime() - 3600_000;
    await db.auditLog.deleteMany({ where: { userId: actor } });
  });

  it("resolves the target of each action family", async () => {
    const bakery = await tx(fx.accounts.own, "Bakery");
    const out = await tx(fx.accounts.own, "Transfer out");
    const inn = await tx(fx.accounts.sharedAi, "Transfer in");
    const third = await tx(fx.accounts.sharedPlain, "Third leg");
    const pairLink = await link([out, inn]);
    const wideLink = await link([bakery, third, await tx(fx.accounts.own, "Fourth leg")]);
    const personal = await budget("Holidays", { userId: actor });
    const ownCategory = (await db.category.create({ data: { userId: actor, name: "Pets" } })).id;
    const household = await budget("Groceries", { groupId: fx.groupId });
    const [first, second] = [bakery, inn].sort();
    const labelOf = (id: string) => (id === bakery ? "Bakery" : "Transfer in");

    const ids = {
      updated: await row("transaction.updated", "Transaction", bakery),
      linked: await row("link.created", "TransactionLink", pairLink),
      wide: await row("link.created", "TransactionLink", wideLink),
      unlinked: await row("link.deleted", "TransactionLink", "gone_link"),
      opposite: await row("link.oppositeCreated", "TransactionLink", pairLink, {
        sourceId: inn,
        legId: out,
      }),
      ignored: await row("link.suggestionIgnored", "IgnoredLinkSuggestion", `${first}|${second}`),
      budget: await row("budget.updated", "Budget", personal),
      householdBudget: await row("budget.archived", "Budget", household),
      assigned: await row("budget.assignment.create", "BudgetAssignment", `${personal}:${bakery}`),
      other: await row("link.autoCreated", "User", actor),
      category: await row("category.updated", "Category", ownCategory),
    };

    const got = await targets();
    expect(got.get(ids.updated)).toEqual({ text: "Bakery", href: null });
    expect(got.get(ids.linked)).toEqual({ text: "Transfer out ↔ Transfer in", href: null });
    expect(got.get(ids.wide)).toEqual({ text: "Bakery +2", href: null });
    expect(got.get(ids.unlinked)).toBeNull();
    expect(got.get(ids.opposite)).toEqual({ text: "Transfer in ↔ Transfer out", href: null });
    expect(got.get(ids.ignored)).toEqual({
      text: `${labelOf(first)} ↔ ${labelOf(second)}`,
      href: null,
    });
    expect(got.get(ids.budget)).toEqual({ text: "Holidays", href: `/budgets/${personal}` });
    expect(got.get(ids.householdBudget)).toEqual({
      text: "Groceries",
      href: `/budgets/${household}`,
    });
    expect(got.get(ids.assigned)).toEqual({
      text: "Bakery → Holidays",
      href: `/budgets/${personal}`,
    });
    expect(got.get(ids.other)).toBeNull();
    expect(got.get(ids.category)).toEqual({ text: "Pets", href: "/categories" });
  });

  it("resolves an account to its name while the user can see it", async () => {
    const updated = await row("account.updated", "BankAccount", fx.accounts.own);
    const shared = await row("account.updated", "BankAccount", fx.accounts.sharedAi);
    const unshared = await db.bankAccount.create({
      data: { ownerId: fx.ownerId, name: "unshared", type: "CHECKING" },
    });
    const hidden = await row("account.updated", "BankAccount", unshared.id);
    const gone = await row("account.updated", "BankAccount", "gone_account");
    let got = await targets();
    expect(got.get(updated)).toEqual({ text: "own", href: "/accounts" });
    expect(got.get(shared)).toEqual({ text: "shared-ai", href: "/accounts" });
    expect(got.get(hidden)).toBeNull();
    expect(got.get(gone)).toBeNull();
    await db.groupMember.deleteMany({ where: { groupId: fx.groupId, userId: actor } });
    got = await targets();
    expect(got.get(shared)).toBeNull();
  });

  it("drops a household category of a household the user left", async () => {
    const updated = await row("category.updated", "Category", fx.categoryId);
    const deleted = await row("category.updated", "Category", "gone_category");
    expect((await targets()).get(updated)).toEqual({ text: "Groceries", href: "/categories" });
    expect((await targets()).get(deleted)).toBeNull();
    await db.groupMember.deleteMany({ where: { groupId: fx.groupId, userId: actor } });
    expect((await targets()).get(updated)).toBeNull();
  });

  it("resolves a rule to its pattern while the user can read it", async () => {
    const own = await db.categorizationRule.create({
      data: { pattern: "BAKERY", matchType: "CONTAINS", categoryId: fx.categoryId, userId: actor },
    });
    const household = await db.categorizationRule.create({
      data: {
        pattern: "MARKET",
        matchType: "CONTAINS",
        categoryId: fx.categoryId,
        groupId: fx.groupId,
      },
    });
    const gone = await db.categorizationRule.create({
      data: { pattern: "GONE", matchType: "CONTAINS", categoryId: fx.categoryId, userId: actor },
    });
    const updated = await row("rule.updated", "CategorizationRule", own.id);
    const applied = await row("rule.applied", "CategorizationRule", household.id);
    const deleted = await row("rule.deleted", "CategorizationRule", gone.id);
    await db.categorizationRule.delete({ where: { id: gone.id } });

    let got = await targets();
    expect(got.get(updated)).toEqual({ text: "BAKERY", href: "/categories" });
    expect(got.get(applied)).toEqual({ text: "MARKET", href: "/categories" });
    expect(got.get(deleted)).toBeNull();
    await db.groupMember.deleteMany({ where: { groupId: fx.groupId, userId: actor } });
    got = await targets();
    expect(got.get(applied)).toBeNull();
  });

  it("drops a transaction on an account no longer shared with the user", async () => {
    const shared = await tx(fx.accounts.sharedPlain, "Shared rent");
    const own = await tx(fx.accounts.own, "Own rent");
    const single = await row("transaction.recategorized", "Transaction", shared);
    const linked = await row("link.created", "TransactionLink", await link([own, shared]));
    await db.accountShare.deleteMany({ where: { accountId: fx.accounts.sharedPlain } });

    const got = await targets();
    expect(got.get(single)).toBeNull();
    expect(got.get(linked)).toEqual({ text: "Own rent", href: null });
  });

  it("drops a budget of a household the user left", async () => {
    const household = await budget("Shared food", { groupId: fx.groupId });
    const own = await tx(fx.accounts.own, "Market");
    const updated = await row("budget.updated", "Budget", household);
    const assigned = await row(
      "budget.assignment.create",
      "BudgetAssignment",
      `${household}:${own}`,
    );
    await db.groupMember.deleteMany({ where: { groupId: fx.groupId, userId: actor } });

    const got = await targets();
    expect(got.get(updated)).toBeNull();
    expect(got.get(assigned)).toEqual({ text: "Market", href: null });
  });

  it("has no target for a deleted transaction or budget", async () => {
    const gone = await tx(fx.accounts.own, "Gone");
    const goneBudget = await budget("Gone budget", { userId: actor });
    const txRow = await row("transaction.updated", "Transaction", gone);
    const budgetRow = await row("budget.deleted", "Budget", goneBudget);
    await db.transaction.delete({ where: { id: gone } });
    await db.budget.delete({ where: { id: goneBudget } });

    const got = await targets();
    expect(got.get(txRow)).toBeNull();
    expect(got.get(budgetRow)).toBeNull();
  });
});

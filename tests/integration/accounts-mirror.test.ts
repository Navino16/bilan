import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import {
  AccountAccessError,
  getSavingsMirror,
  listVisibleForUser,
  setSavingsMirror,
  updateAccount,
} from "@/server/services/accounts";
import { defaultMirrorPattern, MIRROR_PATTERN_MAX } from "@/lib/validation/account";

const owner = "accmirror_owner";
const other = "accmirror_other";
let livret: string;
let courant: string;
let joint: string;
let foreign: string;

const account = (ownerId: string, name: string, type: string) =>
  db.bankAccount.create({ data: { ownerId, name, type } }).then((a) => a.id);

beforeAll(async () => {
  await db.user.deleteMany({ where: { id: { in: [owner, other] } } });
  for (const id of [owner, other]) {
    await db.user.create({ data: { id, email: `${id}@bilan.local` } });
  }
  livret = await account(owner, "Livret A", "SAVINGS");
  courant = await account(owner, "Courant", "CHECKING");
  joint = await account(owner, "Joint", "CHECKING");
  foreign = await account(other, "Autre", "CHECKING");
});

beforeEach(async () => {
  await db.savingsMirrorSource.deleteMany({ where: { savingsAccountId: livret } });
  await db.bankAccount.update({
    where: { id: livret },
    data: { type: "SAVINGS", mirrorPattern: null, mirrorMatchType: "CONTAINS" },
  });
});

afterAll(async () => {
  await db.auditLog.deleteMany({ where: { userId: { in: [owner, other] } } });
  await db.user.deleteMany({ where: { id: { in: [owner, other] } } });
  await db.$disconnect();
});

describe("savings mirror settings", () => {
  it("stores the sources and the pattern of a savings account", async () => {
    await setSavingsMirror(owner, livret, {
      sourceAccountIds: [courant, joint, courant],
      pattern: "  LIVRET A ",
    });
    const expected = {
      sourceAccountIds: [courant, joint].sort(),
      pattern: "LIVRET A",
      matchType: "CONTAINS",
    };
    expect(await getSavingsMirror(owner, livret)).toEqual(expected);
    const view = (await listVisibleForUser(owner)).find((a) => a.id === livret);
    expect(view?.mirror).toEqual(expected);
    const audit = await db.auditLog.findFirstOrThrow({
      where: { action: "account.mirror_updated", entityId: livret },
    });
    expect(audit.metadata).toEqual({ sources: 2, matchType: "CONTAINS" });
  });

  it("stores the exact label mode, and falls back to contains when omitted", async () => {
    await setSavingsMirror(owner, livret, {
      sourceAccountIds: [courant],
      pattern: "VIR.PERMANENT Livret A",
      matchType: "EXACT",
    });
    expect(await getSavingsMirror(owner, livret)).toMatchObject({ matchType: "EXACT" });
    await setSavingsMirror(owner, livret, { sourceAccountIds: [courant], pattern: "LIVRET A" });
    expect(await getSavingsMirror(owner, livret)).toMatchObject({ matchType: "CONTAINS" });
  });

  it("rejects an unknown match mode", async () => {
    const err = await setSavingsMirror(owner, livret, {
      sourceAccountIds: [courant],
      pattern: "LIVRET A",
      matchType: "REGEX" as "EXACT",
    }).catch((e: unknown) => e);
    expect((err as Error).message).toBe("INVALID_MIRROR");
    expect(await getSavingsMirror(owner, livret)).toBeNull();
  });

  it("null turns it off", async () => {
    await setSavingsMirror(owner, livret, { sourceAccountIds: [courant], pattern: "LIVRET A" });
    await setSavingsMirror(owner, livret, null);
    expect(await getSavingsMirror(owner, livret)).toBeNull();
    expect(await db.savingsMirrorSource.count({ where: { savingsAccountId: livret } })).toBe(0);
  });

  it.each([
    ["a non-savings account", () => courant, () => [joint], "LIVRET A"],
    ["a source owned by someone else", () => livret, () => [courant, foreign], "LIVRET A"],
    ["the account itself as a source", () => livret, () => [livret], "LIVRET A"],
    ["no source", () => livret, () => [], "LIVRET A"],
    ["a blank pattern", () => livret, () => [courant], "   "],
    ["a pattern too long", () => livret, () => [courant], "A".repeat(MIRROR_PATTERN_MAX + 1)],
  ])("rejects %s", async (_, target, sources, pattern) => {
    const err = await setSavingsMirror(owner, target(), {
      sourceAccountIds: sources(),
      pattern,
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AccountAccessError);
    expect((err as Error).message).toBe("INVALID_MIRROR");
    expect(await getSavingsMirror(owner, livret)).toBeNull();
  });

  it("only the owner sets or reads it", async () => {
    await expect(
      setSavingsMirror(other, livret, { sourceAccountIds: [foreign], pattern: "LIVRET A" }),
    ).rejects.toThrow("FORBIDDEN");
    await expect(getSavingsMirror(other, livret)).rejects.toThrow("FORBIDDEN");
  });

  it("is cleared when the account stops being a savings account", async () => {
    await setSavingsMirror(owner, livret, {
      sourceAccountIds: [courant],
      pattern: "LIVRET A",
      matchType: "EXACT",
    });
    await updateAccount(livret, { name: "Livret A", type: "CHECKING" }, { id: owner });
    expect(await getSavingsMirror(owner, livret)).toBeNull();
    const row = await db.bankAccount.findUniqueOrThrow({ where: { id: livret } });
    expect(row.mirrorMatchType).toBe("CONTAINS");
    expect(await db.savingsMirrorSource.count({ where: { savingsAccountId: livret } })).toBe(0);
  });

  it("derives the default pattern from the account name", () => {
    expect(defaultMirrorPattern("Livret A Épargne")).toBe("LIVRET A EPARGNE");
    expect(defaultMirrorPattern("  Livret Jeune ")).toBe("LIVRET JEUNE");
  });
});

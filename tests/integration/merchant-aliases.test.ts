import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { db } from "@/server/db";
import {
  deleteAliasGroup,
  listAliasGroups,
  loadAliases,
  MerchantAliasError,
  renameAliasGroup,
  removeMerchantAlias,
  renameMerchant,
} from "@/server/services/merchants";

const owner = "malias_owner";
const stranger = "malias_stranger";

beforeAll(async () => {
  await db.user.deleteMany({ where: { id: { in: [owner, stranger] } } });
  await db.user.create({ data: { id: owner, email: "malias-owner@bilan.local" } });
  await db.user.create({ data: { id: stranger, email: "malias-stranger@bilan.local" } });
});

beforeEach(async () => {
  await db.merchantAlias.deleteMany({ where: { userId: { in: [owner, stranger] } } });
});

afterAll(async () => {
  await db.user.deleteMany({ where: { id: { in: [owner, stranger] } } });
  await db.$disconnect();
});

describe("merchant aliases", () => {
  it("renames a merchant, then updates the same row on a second rename", async () => {
    await renameMerchant(owner, "FONCIA LOYER", "  Loyer ");
    await renameMerchant(owner, "FONCIA LOYER", "Loyer appart");
    expect(await loadAliases(owner)).toEqual(new Map([["FONCIA LOYER", "Loyer appart"]]));
    expect(await db.merchantAlias.count({ where: { userId: owner } })).toBe(1);
  });

  it("stores neither the merchant key nor the name in plaintext", async () => {
    await renameMerchant(owner, "FONCIA LOYER", "Loyer");
    const row = await db.merchantAlias.findFirstOrThrow({ where: { userId: owner } });
    expect(JSON.stringify(row)).not.toMatch(/FONCIA|Loyer/i);
  });

  it("merges into an existing name whatever its case", async () => {
    await renameMerchant(owner, "LIDL", "Supermarché");
    await renameMerchant(owner, "CARREFOUR MARKET", "supermarché");
    expect(await listAliasGroups(owner)).toEqual([
      { name: "Supermarché", keys: ["CARREFOUR MARKET", "LIDL"] },
    ]);
  });

  it("renames a whole group, including a case-only change", async () => {
    await renameMerchant(owner, "LIDL", "courses");
    await renameMerchant(owner, "MONOPRIX", "courses");
    await renameAliasGroup(owner, "courses", "Courses");
    expect(await listAliasGroups(owner)).toEqual([{ name: "Courses", keys: ["LIDL", "MONOPRIX"] }]);
  });

  it("merges two groups when one is renamed to the other's name", async () => {
    await renameMerchant(owner, "LIDL", "Supermarché");
    await renameMerchant(owner, "MONOPRIX", "Courses");
    await renameAliasGroup(owner, "Courses", "SUPERMARCHÉ");
    expect(await listAliasGroups(owner)).toEqual([
      { name: "Supermarché", keys: ["LIDL", "MONOPRIX"] },
    ]);
  });

  it("deletes a group back to the bank labels", async () => {
    await renameMerchant(owner, "LIDL", "Supermarché");
    await renameMerchant(owner, "NETFLIX.COM", "Abonnements");
    await deleteAliasGroup(owner, "Supermarché");
    expect(await loadAliases(owner)).toEqual(new Map([["NETFLIX.COM", "Abonnements"]]));
  });

  it("rejects an empty name", async () => {
    await expect(renameMerchant(owner, "LIDL", "   ")).rejects.toThrow();
  });

  it("keeps users apart", async () => {
    await renameMerchant(owner, "LIDL", "Supermarché");
    await renameMerchant(stranger, "LIDL", "Lidl du coin");
    await expect(renameAliasGroup(stranger, "Supermarché", "Piraté")).rejects.toThrow(
      MerchantAliasError,
    );
    await expect(deleteAliasGroup(stranger, "Supermarché")).rejects.toThrow(MerchantAliasError);
    expect(await loadAliases(owner)).toEqual(new Map([["LIDL", "Supermarché"]]));
    expect(await loadAliases(stranger)).toEqual(new Map([["LIDL", "Lidl du coin"]]));
  });

  it("canonicalizes the merchant key sent by the client", async () => {
    await renameMerchant(owner, " lidl ", "Supermarché");
    await renameMerchant(owner, "LIDL", "Courses");
    expect(await loadAliases(owner)).toEqual(new Map([["LIDL", "Courses"]]));
  });

  it("moves a merchant to another group, the old one shrinking then vanishing", async () => {
    await renameMerchant(owner, "LIDL", "Supermarché");
    await renameMerchant(owner, "MONOPRIX", "Supermarché");
    await renameMerchant(owner, "MONOPRIX", "Proxi");
    expect(await listAliasGroups(owner)).toEqual([
      { name: "Proxi", keys: ["MONOPRIX"] },
      { name: "Supermarché", keys: ["LIDL"] },
    ]);
    await renameMerchant(owner, "LIDL", "Proxi");
    expect(await listAliasGroups(owner)).toEqual([{ name: "Proxi", keys: ["LIDL", "MONOPRIX"] }]);
  });

  it("removes one merchant from a group", async () => {
    await renameMerchant(owner, "LIDL", "Supermarché");
    await renameMerchant(owner, "MONOPRIX", "Supermarché");
    await removeMerchantAlias(owner, "LIDL");
    expect(await listAliasGroups(owner)).toEqual([{ name: "Supermarché", keys: ["MONOPRIX"] }]);
    await expect(removeMerchantAlias(owner, "LIDL")).rejects.toThrow(MerchantAliasError);
  });

  it("reports a missing group of the user's own", async () => {
    await expect(renameAliasGroup(owner, "Nope", "X")).rejects.toThrow(MerchantAliasError);
    await expect(deleteAliasGroup(owner, "Nope")).rejects.toThrow(MerchantAliasError);
  });
});

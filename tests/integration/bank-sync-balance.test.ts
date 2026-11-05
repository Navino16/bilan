import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { encrypt } from "@/server/crypto/encryption";
import { dataKey } from "@/server/crypto/keys";
import { listBankBalanceChecks } from "@/server/services/bank-sync/balance";
import { buildSecureFields } from "@/server/services/transactions/secure-fields";

const owner = "bsbal_owner";
const member = "bsbal_member";

let courant: string;
let livret: string;
let joint: string;
let courantLink: string;

const validUntil = new Date("2027-05-02T09:00:00.000Z");
const day = (d: string) => new Date(`${d}T00:00:00.000Z`);

async function addRow(accountId: string, date: string, amount: number) {
  const secure = buildSecureFields({ label: "T", rawLabel: `T${date}${amount}` });
  await db.transaction.create({
    data: {
      accountId,
      date: day(date),
      amount,
      type: "OTHER",
      labelEnc: secure.labelEnc,
      labelHash: secure.labelHash,
      rawLabelEnc: secure.rawLabelEnc,
      rawLabelHash: secure.rawLabelHash,
      createdById: owner,
    },
  });
}

function link(accountId: string, n: number, balances: Record<string, unknown> = {}) {
  return {
    uidEnc: encrypt(`uid-fake-${n}`, dataKey),
    name: `Compte Test ${n}`,
    currency: "EUR",
    accountId,
    ...balances,
  };
}

beforeAll(async () => {
  await db.user.createMany({
    data: [
      { id: owner, email: "bsbal-owner@bilan.local" },
      { id: member, email: "bsbal-member@bilan.local" },
    ],
  });
  const account = (name: string, initialBalance: number) =>
    db.bankAccount.create({ data: { ownerId: owner, name, type: "CHECKING", initialBalance } });
  courant = (await account("Courant", 1000)).id;
  livret = (await account("Livret", 0.1)).id;
  joint = (await account("Joint", 0)).id;
  const noBooked = (await account("Sans solde", 0)).id;

  await addRow(courant, "2026-10-20", -200);
  await addRow(courant, "2026-11-02", 50);
  await addRow(livret, "2026-10-31", 0.2);
  await addRow(livret, "2026-11-01", 7);

  const group = await db.group.create({
    data: {
      name: "Foyer test",
      createdById: owner,
      members: {
        create: [
          { userId: owner, role: "OWNER" },
          { userId: member, role: "MEMBER" },
        ],
      },
    },
  });
  await db.accountShare.create({
    data: { accountId: courant, groupId: group.id, permission: "WRITE", createdById: owner },
  });

  const conn = await db.bankConnection.create({
    data: {
      userId: owner,
      aspspName: "Banque Fictive",
      aspspCountry: "FR",
      sessionIdEnc: encrypt("sess-fake-1", dataKey),
      validUntil,
      accounts: {
        create: [
          // CLBD missing a row the bank booked later with an earlier date, as LCL does.
          link(courant, 1, {
            bookedBalance: 750,
            bookedBalanceDate: day("2026-10-31"),
            expectedBalance: 862.5,
            expectedBalanceDate: day("2026-11-03"),
            pendingTotal: 12.5,
          }),
          link(livret, 2, { bookedBalance: 0.3, bookedBalanceDate: day("2026-10-31") }),
          link(noBooked, 3),
        ],
      },
    },
    include: { accounts: true },
  });
  courantLink = conn.accounts.find((a) => a.accountId === courant)!.id;

  await db.bankConnection.create({
    data: {
      userId: owner,
      aspspName: "Autre Banque",
      aspspCountry: "FR",
      sessionIdEnc: encrypt("sess-fake-2", dataKey),
      validUntil,
      status: "REVOKED",
      accounts: {
        create: link(joint, 4, { bookedBalance: 5, bookedBalanceDate: day("2026-10-31") }),
      },
    },
  });
  // Unreachable through the mapping page; the check must not trust the link alone.
  await db.bankConnection.create({
    data: {
      userId: member,
      aspspName: "Banque Du Membre",
      aspspCountry: "FR",
      sessionIdEnc: encrypt("sess-fake-3", dataKey),
      validUntil,
      accounts: {
        create: link(courant, 5, { bookedBalance: 9, bookedBalanceDate: day("2026-10-31") }),
      },
    },
  });
});

afterAll(async () => {
  await db.group.deleteMany({ where: { createdById: owner } });
  await db.user.deleteMany({ where: { id: { in: [owner, member] } } });
  await db.$disconnect();
});

describe("listBankBalanceChecks", () => {
  it("compares the expected balance minus pending rows with Bilan's at its day", async () => {
    const checks = await listBankBalanceChecks(owner);
    expect(checks[courant]).toEqual({
      bankBalance: 850,
      date: "2026-11-03",
      bilanBalance: 850,
      gap: 0,
      expectedBalance: 862.5,
      expectedDate: "2026-11-03",
    });
  });

  it("reports the gap as bank minus Bilan", async () => {
    await db.bankConnectionAccount.update({
      where: { id: courantLink },
      data: { expectedBalance: 812.5 },
    });
    try {
      const checks = await listBankBalanceChecks(owner);
      expect(checks[courant]).toMatchObject({ bankBalance: 800, bilanBalance: 850, gap: -50 });
    } finally {
      await db.bankConnectionAccount.update({
        where: { id: courantLink },
        data: { expectedBalance: 862.5 },
      });
    }
  });

  it("falls back to the booked balance at its day, not later rows, with no float drift", async () => {
    const checks = await listBankBalanceChecks(owner);
    expect(checks[livret]).toEqual({
      bankBalance: 0.3,
      date: "2026-10-31",
      bilanBalance: 0.3,
      gap: 0,
      expectedBalance: null,
      expectedDate: null,
    });
  });

  it("leaves out accounts without a booked balance or on a revoked connection", async () => {
    const checks = await listBankBalanceChecks(owner);
    expect(Object.keys(checks).sort()).toEqual([courant, livret].sort());
    expect(checks[joint]).toBeUndefined();
  });

  it("shows nothing to a group member, even through their own connection", async () => {
    expect(await listBankBalanceChecks(member)).toEqual({});
  });
});

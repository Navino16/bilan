import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "@/server/db";
import { dataKey } from "@/server/crypto/keys";
import { decrypt } from "@/server/crypto/encryption";
import {
  createAccount,
  updateAccount,
  archiveAccount,
  getAccountForUser,
  listVisibleForUser,
  AccountAccessError,
} from "@/server/services/accounts";

const ownerId = "acc_owner";
const otherId = "acc_other";
const iban = "FR7630006000011234567890189";

beforeAll(async () => {
  await db.bankAccount.deleteMany({ where: { ownerId: { in: [ownerId, otherId] } } });
  await db.user.deleteMany({ where: { id: { in: [ownerId, otherId] } } });
  await db.user.create({ data: { id: ownerId, email: "acc-owner@bilan.local" } });
  await db.user.create({ data: { id: otherId, email: "acc-other@bilan.local" } });
});

afterAll(async () => {
  await db.bankAccount.deleteMany({ where: { ownerId: { in: [ownerId, otherId] } } });
  await db.user.deleteMany({ where: { id: { in: [ownerId, otherId] } } });
  await db.$disconnect();
});

describe("accounts service", () => {
  it("creates an account, encrypting the IBAN and storing a non-plaintext hash", async () => {
    const acc = await createAccount(
      {
        name: "Compte courant",
        type: "CHECKING",
        iban,
        bankName: "BNP",
        initialBalance: "1234,56",
      },
      ownerId,
    );
    const row = await db.bankAccount.findUniqueOrThrow({ where: { id: acc.id } });
    expect(row.ibanEnc).toBeTruthy();
    expect(row.ibanEnc).not.toContain(iban); // stored ciphertext, not plaintext
    expect(decrypt(row.ibanEnc!, dataKey)).toBe(iban); // round-trips
    expect(row.ibanHash).toBeTruthy();
    expect(row.ibanHash).not.toBe(iban);
    expect(Number(row.initialBalance)).toBe(1234.56); // parsed comma decimal, stored in clear

    const audit = await db.auditLog.findFirst({
      where: { action: "account.created", entityId: acc.id },
    });
    expect(audit).not.toBeNull();
  });

  it("rejects an IBAN that fails the mod-97 check", async () => {
    await expect(
      createAccount({ name: "Bad", type: "OTHER", iban: "FR7630006000011234567890188" }, ownerId),
    ).rejects.toBeInstanceOf(AccountAccessError);
  });

  it("blocks update/archive by a non-owner", async () => {
    const acc = await createAccount({ name: "Mine", type: "SAVINGS" }, ownerId);
    await expect(
      updateAccount(acc.id, { name: "Hacked", type: "SAVINGS" }, { id: otherId }),
    ).rejects.toBeInstanceOf(AccountAccessError);
    await expect(archiveAccount(acc.id, { id: otherId })).rejects.toBeInstanceOf(
      AccountAccessError,
    );
  });

  it("getAccountForUser returns null for a non-owner and the row for the owner", async () => {
    const acc = await createAccount({ name: "Visible", type: "OTHER" }, ownerId);
    expect(await getAccountForUser(acc.id, otherId)).toBeNull();
    expect((await getAccountForUser(acc.id, ownerId))?.id).toBe(acc.id);
  });

  it("listVisibleForUser returns own non-archived accounts with OWNER access and a masked IBAN", async () => {
    const before = await listVisibleForUser(ownerId);
    const acc = await createAccount(
      { name: "ToArchive", type: "OTHER", iban, initialBalance: 500 },
      ownerId,
    );
    const withNew = await listVisibleForUser(ownerId);
    expect(withNew.length).toBe(before.length + 1);
    const created = withNew.find((a) => a.id === acc.id)!;
    expect(created.access).toBe("OWNER");
    expect(created.balance).toBe(500);
    expect(created.ibanMasked).toBe("•••• 0189");

    await archiveAccount(acc.id, { id: ownerId });
    const afterArchive = await listVisibleForUser(ownerId);
    expect(afterArchive.find((a) => a.id === acc.id)).toBeUndefined(); // archived hidden by default
  });
});

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const session = vi.hoisted(() => ({ user: null as { id: string } | null }));
vi.mock("@/server/auth/permissions", () => ({
  getCurrentUser: async () => session.user,
}));
import { env } from "@/env";
import { db } from "@/server/db";
import { encrypt } from "@/server/crypto/encryption";
import { hmacExact } from "@/server/crypto/hmac";
import { dataKey, searchKey } from "@/server/crypto/keys";
import { clearBankListCache, startBankAuth } from "@/server/services/bank-sync/connect";
import { GET } from "@/app/api/bank-sync/callback/route";
import {
  clearBankSyncConfig,
  FAKE_IBAN,
  fakeEnableBanking,
  fakeTx,
  seedBankSyncConfig,
  type FakeBank,
} from "../fixtures/enable-banking";

const owner = "bscb_owner";
let fake: FakeBank;

async function start(reconnectOf?: string): Promise<string> {
  await startBankAuth(owner, { aspspName: "Banque Fictive", country: "FR", reconnectOf });
  const auth = fake.calls.filter((c) => c.path === "/auth").at(-1)!;
  return (auth.body as { state: string }).state;
}

const callback = (query: Record<string, string>) =>
  GET(
    new Request(`http://localhost/api/bank-sync/callback?${new URLSearchParams(query)}`, {
      headers: {
        cookie: "NEXT_LOCALE=en",
        [env.TRUSTED_IP_HEADER]: "203.0.113.7",
        "user-agent": "Test UA",
      },
    }),
  );

// An expired consent whose IBAN account is mapped to `accountId`; the default session returns it.
async function expiredConnection(accountId: string): Promise<string> {
  const conn = await db.bankConnection.create({
    data: {
      userId: owner,
      aspspName: "Banque Fictive",
      aspspCountry: "FR",
      sessionIdEnc: encrypt("sess-old", dataKey),
      validUntil: new Date("2026-08-01T00:00:00.000Z"),
      status: "EXPIRED",
      accounts: {
        create: [
          {
            uidEnc: encrypt("uid-old-a", dataKey),
            ibanHash: hmacExact(FAKE_IBAN, searchKey),
            name: "Compte Courant Test",
            currency: "EUR",
            accountId,
            lastSyncedDate: new Date("2026-06-01T00:00:00.000Z"),
          },
          { uidEnc: encrypt("uid-old-b", dataKey), name: "Compte Joint Test", currency: "EUR" },
        ],
      },
    },
  });
  return conn.id;
}

function location(res: Response): URL {
  expect(res.status).toBe(302);
  const to = new URL(res.headers.get("location")!);
  expect(to.origin).toBe(new URL(env.APP_URL).origin);
  expect(to.searchParams.has("code") || to.searchParams.has("state")).toBe(false);
  return to;
}

beforeAll(async () => {
  await db.user.create({ data: { id: owner, email: "bscb-owner@bilan.local" } });
  await seedBankSyncConfig();
});

beforeEach(() => {
  fake = fakeEnableBanking();
  vi.stubGlobal("fetch", fake.fetch);
  clearBankListCache();
  session.user = { id: owner };
});

afterAll(async () => {
  vi.unstubAllGlobals();
  await db.auditLog.deleteMany({ where: { userId: owner } });
  await db.user.deleteMany({ where: { id: owner } });
  await clearBankSyncConfig();
  await db.$disconnect();
});

describe("GET /api/bank-sync/callback", () => {
  it("lands on the mapping page of the new connection", async () => {
    const state = await start();
    const to = location(await callback({ state, code: "code-1" }));
    const conn = await db.bankConnection.findFirstOrThrow({ where: { userId: owner } });
    expect(to.pathname).toBe(`/en/accounts/bank-sync/${conn.id}`);
    expect(to.search).toBe("");
  });

  it("explains an unknown state or a denied consent on the accounts page", async () => {
    const unknown = location(await callback({ state: "not-a-state", code: "c" }));
    expect(unknown.pathname).toBe("/en/accounts");
    expect(unknown.searchParams.get("bankSync")).toBe("UNKNOWN_STATE");

    const state = await start();
    const denied = location(await callback({ state, error: "access_denied" }));
    expect(denied.searchParams.get("bankSync")).toBe("DENIED");
    expect(fake.calls.filter((c) => c.path === "/sessions")).toHaveLength(0);
  });

  it("syncs a reconnect without new accounts while the user is present", async () => {
    const courant = (
      await db.bankAccount.create({ data: { ownerId: owner, name: "Courant", type: "CHECKING" } })
    ).id;
    const old = await expiredConnection(courant);
    fake.on("GET", /\/transactions$/, {
      body: { transactions: [fakeTx({ date: "2026-06-10", amount: -9, label: "CB CAFE TEST" })] },
    });
    const state = await start(old);
    const to = location(await callback({ state, code: "code-r" }));
    expect(to.pathname).toBe("/en/accounts");
    expect(to.searchParams.get("bankSync")).toBe("RECONNECTED");

    const tx = fake.calls.find((c) => c.path === "/accounts/uid-fake-a/transactions")!;
    expect(tx.query.get("date_from")).toBe("2026-05-25");
    for (const c of fake.calls.filter((c) => c.path.startsWith("/accounts/"))) {
      expect(c.headers.get("psu-ip-address")).toBe("203.0.113.7");
      expect(c.headers.get("psu-user-agent")).toBe("Test UA");
    }
    expect(await db.transaction.count({ where: { accountId: courant } })).toBe(1);
    expect((await db.bankConnection.findUniqueOrThrow({ where: { id: old } })).status).toBe(
      "REVOKED",
    );
    await db.bankConnection.deleteMany({ where: { userId: owner } });
    await db.transaction.deleteMany({ where: { accountId: courant } });
    await db.importBatch.deleteMany({ where: { accountId: courant } });
    await db.bankAccount.delete({ where: { id: courant } });
  });

  it("sends a reconnect with a new account to the mapping page without syncing", async () => {
    const courant = (
      await db.bankAccount.create({ data: { ownerId: owner, name: "Courant", type: "CHECKING" } })
    ).id;
    const old = await expiredConnection(courant);
    fake.on("POST", "/sessions", {
      body: {
        session_id: "sess-new",
        access: { valid_until: "2027-05-02T09:00:00.000Z" },
        accounts: [
          { uid: "uid-fake-a", name: "Compte Courant Test", account_id: { iban: FAKE_IBAN } },
          { uid: "uid-fake-n", name: "Livret Test" },
        ],
      },
    });
    const state = await start(old);
    const to = location(await callback({ state, code: "code-r" }));
    const conn = await db.bankConnection.findFirstOrThrow({
      where: { userId: owner, status: "ACTIVE" },
    });
    expect(to.pathname).toBe(`/en/accounts/bank-sync/${conn.id}`);
    expect(fake.calls.some((c) => c.path.startsWith("/accounts/"))).toBe(false);
    await db.bankConnection.deleteMany({ where: { userId: owner } });
    await db.bankAccount.delete({ where: { id: courant } });
  });

  it("changes nothing for a signed-out browser", async () => {
    const state = await start();
    session.user = null;
    const to = location(await callback({ state, code: "c" }));
    expect(to.searchParams.get("bankSync")).toBe("SIGNED_OUT");
    expect(await db.bankAuthRequest.count({ where: { userId: owner } })).toBe(1);
    expect(fake.calls.filter((c) => c.path === "/sessions")).toHaveLength(0);
    await db.bankAuthRequest.deleteMany({ where: { userId: owner } });
  });
});

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const session = vi.hoisted(() => ({ user: null as { id: string } | null }));
vi.mock("@/server/auth/permissions", () => ({
  getCurrentUser: async () => session.user,
}));
import { env } from "@/env";
import { db } from "@/server/db";
import { clearBankListCache, startBankAuth } from "@/server/services/bank-sync/connect";
import { GET } from "@/app/api/bank-sync/callback/route";
import {
  clearBankSyncConfig,
  fakeEnableBanking,
  seedBankSyncConfig,
  type FakeBank,
} from "../fixtures/enable-banking";

const owner = "bscb_owner";
let fake: FakeBank;

async function start(): Promise<string> {
  await startBankAuth(owner, { aspspName: "Banque Fictive", country: "FR" });
  const auth = fake.calls.filter((c) => c.path === "/auth").at(-1)!;
  return (auth.body as { state: string }).state;
}

const callback = (query: Record<string, string>) =>
  GET(
    new Request(`http://localhost/api/bank-sync/callback?${new URLSearchParams(query)}`, {
      headers: { cookie: "NEXT_LOCALE=en" },
    }),
  );

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

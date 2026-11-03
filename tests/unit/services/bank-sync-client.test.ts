import { createVerify } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  createEnableBankingClient,
  EnableBankingError,
  MAX_TRANSACTION_PAGES,
  signJwt,
} from "@/server/services/bank-sync/client";
import { fakeEnableBanking, fakeTx, testKeyPair, FAKE_IBAN } from "../../fixtures/enable-banking";

function clientFor(bank: ReturnType<typeof fakeEnableBanking>) {
  return createEnableBankingClient({
    applicationId: "app-test-id",
    privateKeyPem: testKeyPair().privateKeyPem,
    fetch: bank.fetch,
  });
}

async function caught(promise: Promise<unknown>): Promise<EnableBankingError> {
  try {
    await promise;
  } catch (e) {
    expect(e).toBeInstanceOf(EnableBankingError);
    return e as EnableBankingError;
  }
  throw new Error("expected a rejection");
}

describe("Enable Banking client", () => {
  it("signs an RS256 JWT the application's public key verifies", () => {
    const { privateKeyPem, publicKey } = testKeyPair();
    const token = signJwt("app-test-id", privateKeyPem, new Date("2026-11-03T00:00:00.000Z"));
    const [h, p, s] = token.split(".");
    expect(JSON.parse(Buffer.from(h, "base64url").toString())).toEqual({
      typ: "JWT",
      alg: "RS256",
      kid: "app-test-id",
    });
    expect(JSON.parse(Buffer.from(p, "base64url").toString())).toEqual({
      iss: "enablebanking.com",
      aud: "api.enablebanking.com",
      iat: 1793664000,
      exp: 1793667600,
    });
    expect(
      createVerify("RSA-SHA256").update(`${h}.${p}`).verify(publicKey, Buffer.from(s, "base64url")),
    ).toBe(true);
  });

  it("sends a bearer JWT, and the PSU headers only when given", async () => {
    const bank = fakeEnableBanking();
    const client = clientFor(bank);
    await client.balances("uid-fake-a", { ip: "203.0.113.7", userAgent: "Test UA" });
    await client.balances("uid-fake-a");
    const [present, absent] = bank.calls;
    expect(present.path).toBe("/accounts/uid-fake-a/balances");
    expect(present.headers.get("authorization")).toMatch(/^Bearer /);
    expect(present.headers.get("psu-ip-address")).toBe("203.0.113.7");
    expect(present.headers.get("psu-user-agent")).toBe("Test UA");
    expect(absent.headers.get("authorization")).toMatch(/^Bearer /);
    expect(absent.headers.get("psu-ip-address")).toBeNull();
    expect(absent.headers.get("psu-user-agent")).toBeNull();
  });

  it("follows continuation keys", async () => {
    const bank = fakeEnableBanking();
    const row = fakeTx({ date: "2026-10-02", amount: -2.5, label: "CB CAFE TEST" });
    const pages: Record<string, { transactions: unknown[]; continuation_key?: string }> = {
      "": { transactions: [row, row], continuation_key: "k1" },
      k1: { transactions: [row, row], continuation_key: "k2" },
      k2: { transactions: [row] },
    };
    bank.on("GET", /\/transactions$/, (call) => ({
      body: pages[call.query.get("continuation_key") ?? ""],
    }));
    const rows = await clientFor(bank).transactions("uid-fake-a", "2026-10-01");
    expect(rows).toHaveLength(5);
    expect(bank.calls).toHaveLength(3);
    expect(bank.calls[0].query.get("continuation_key")).toBeNull();
    expect(bank.calls[1].query.get("continuation_key")).toBe("k1");
    expect(bank.calls[2].query.get("continuation_key")).toBe("k2");
    for (const call of bank.calls) expect(call.query.get("date_from")).toBe("2026-10-01");
  });

  it("stops after MAX_TRANSACTION_PAGES pages", async () => {
    const bank = fakeEnableBanking();
    bank.on("GET", /\/transactions$/, { body: { transactions: [], continuation_key: "again" } });
    await clientFor(bank).transactions("uid-fake-a", "2026-10-01");
    expect(MAX_TRANSACTION_PAGES).toBe(50);
    expect(bank.calls).toHaveLength(50);
  });

  it("posts the authorization request", async () => {
    const bank = fakeEnableBanking();
    const client = clientFor(bank);
    const { url } = await client.startAuth({
      aspspName: "Banque Fictive",
      country: "FR",
      validUntil: new Date("2027-05-02T09:00:00.000Z"),
      state: "s1",
      redirectUrl: "https://bilan.test/api/bank-sync/callback",
    });
    expect(url).toBe("https://tilisy.example.test/auth?x=1");
    expect(bank.calls[0]).toMatchObject({ method: "POST", path: "/auth" });
    expect(bank.calls[0].headers.get("content-type")).toBe("application/json");
    expect(bank.calls[0].body).toEqual({
      access: { valid_until: "2027-05-02T09:00:00.000Z" },
      aspsp: { name: "Banque Fictive", country: "FR" },
      state: "s1",
      redirect_url: "https://bilan.test/api/bank-sync/callback",
      psu_type: "personal",
    });

    const session = await client.createSession("code-1");
    expect(bank.calls[1]).toMatchObject({
      method: "POST",
      path: "/sessions",
      body: { code: "code-1" },
    });
    expect(session.accounts[0].account_id?.iban).toBe(FAKE_IBAN);

    await client.deleteSession("sess-fake-1");
    expect(bank.calls[2]).toMatchObject({ method: "DELETE", path: "/sessions/sess-fake-1" });
  });

  it("reads the application and the banks of a country", async () => {
    const bank = fakeEnableBanking();
    const client = clientFor(bank);
    expect(await client.application()).toEqual({
      name: "Bilan test",
      environment: "PRODUCTION",
      active: true,
    });
    expect(await client.aspsps("FR")).toHaveLength(2);
    expect(bank.calls[1].query.get("country")).toBe("FR");
  });

  it.each([
    [422, { error: "EXPIRED_SESSION" }, "EXPIRED_SESSION"],
    [429, { error: "ASPSP_RATE_LIMIT_EXCEEDED" }, "RATE_LIMITED"],
    [400, { error: "ASPSP_RATE_LIMIT_EXCEEDED" }, "RATE_LIMITED"],
    [403, { message: "Application is not active" }, "APP_INACTIVE"],
    [401, {}, "UNAUTHORIZED"],
    [403, {}, "UNAUTHORIZED"],
    [404, {}, "NOT_FOUND"],
    [500, {}, "HTTP"],
  ] as const)("maps a %i %j to %s", async (status, body, code) => {
    const bank = fakeEnableBanking();
    bank.on("GET", "/application", { status, body });
    const err = await caught(clientFor(bank).application());
    expect(err.code).toBe(code);
    expect(err.status).toBe(status);
  });

  it("maps a failed fetch to NETWORK", async () => {
    const client = createEnableBankingClient({
      applicationId: "app-test-id",
      privateKeyPem: testKeyPair().privateKeyPem,
      fetch: async () => {
        throw new TypeError("fetch failed");
      },
    });
    const err = await caught(client.application());
    expect(err.code).toBe("NETWORK");
    expect(err.status).toBeNull();
  });

  it("keeps the response body and ids out of errors", async () => {
    const bank = fakeEnableBanking();
    bank.on("GET", /\/transactions$/, {
      status: 400,
      body: { message: `bad uid-fake-a ${FAKE_IBAN}` },
    });
    const err = await caught(clientFor(bank).transactions("uid-fake-a", "2026-10-01"));
    expect(err.message).toBe("HTTP");
    const dumped = String(err) + JSON.stringify(err) + String(err.stack);
    expect(dumped).not.toContain("uid-fake-a");
    expect(dumped).not.toContain("FR76");
  });
});

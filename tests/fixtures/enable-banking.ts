import { generateKeyPairSync, type KeyObject } from "node:crypto";
import { db } from "@/server/db";
import { encrypt } from "@/server/crypto/encryption";
import { dataKey } from "@/server/crypto/keys";
import { BANK_SYNC_SINGLETON_ID } from "@/server/services/bank-sync/config";
import type { EbTransaction } from "@/server/services/bank-sync/types";

// In-memory Enable Banking API for tests: wire shapes of the POC calls, fake data only.
export type FakeCall = {
  method: string;
  path: string;
  query: URLSearchParams;
  headers: Headers;
  body: unknown;
};
export type FakeReply = { status?: number; body: unknown };
type Route = {
  method: string;
  path: string | RegExp;
  reply: FakeReply | ((call: FakeCall) => FakeReply | Promise<FakeReply>);
};
export type FakeBank = {
  fetch: typeof fetch;
  calls: FakeCall[];
  on(method: string, path: string | RegExp, reply: Route["reply"]): void;
};

export const FAKE_IBAN = "FR7630006000011234567890189";

const defaultRoutes: Route[] = [
  {
    method: "GET",
    path: "/application",
    reply: { body: { name: "Bilan test", environment: "PRODUCTION", active: true } },
  },
  {
    method: "GET",
    path: "/aspsps",
    reply: {
      body: {
        aspsps: [
          {
            name: "Banque Fictive",
            country: "FR",
            maximum_consent_validity: 15552000,
            psu_types: ["personal", "business"],
          },
          {
            name: "Autre Banque",
            country: "FR",
            maximum_consent_validity: 7776000,
            psu_types: ["personal"],
          },
        ],
      },
    },
  },
  {
    method: "POST",
    path: "/auth",
    reply: { body: { url: "https://tilisy.example.test/auth?x=1" } },
  },
  {
    method: "POST",
    path: "/sessions",
    reply: {
      body: {
        session_id: "sess-fake-1",
        access: { valid_until: "2027-05-02T09:00:00.000Z" },
        accounts: [
          {
            uid: "uid-fake-a",
            name: "Compte Courant Test",
            currency: "EUR",
            cash_account_type: "CACC",
            account_id: { iban: FAKE_IBAN },
          },
          {
            uid: "uid-fake-b",
            name: "Compte Joint Test",
            currency: "EUR",
            cash_account_type: "CACC",
          },
        ],
      },
    },
  },
  { method: "DELETE", path: /^\/sessions\/[^/]+$/, reply: { body: {} } },
  { method: "GET", path: /^\/accounts\/[^/]+\/balances$/, reply: { body: { balances: [] } } },
  {
    method: "GET",
    path: /^\/accounts\/[^/]+\/transactions$/,
    reply: { body: { transactions: [] } },
  },
];

function matches(route: Route, method: string, path: string): boolean {
  if (route.method !== method) return false;
  return typeof route.path === "string" ? route.path === path : route.path.test(path);
}

export function fakeEnableBanking(): FakeBank {
  const calls: FakeCall[] = [];
  const overrides: Route[] = [];

  const fakeFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    const method = (init?.method ?? "GET").toUpperCase();
    const raw = typeof init?.body === "string" ? init.body : null;
    const call: FakeCall = {
      method,
      path: url.pathname,
      query: url.searchParams,
      headers: new Headers(init?.headers),
      body: raw === null ? undefined : JSON.parse(raw),
    };
    calls.push(call);
    const route = [...overrides, ...defaultRoutes].find((r) => matches(r, method, call.path));
    if (!route) return Response.json({ error: "NOT_FOUND" }, { status: 404 });
    const reply = typeof route.reply === "function" ? await route.reply(call) : route.reply;
    return Response.json(reply.body ?? {}, { status: reply.status ?? 200 });
  };

  return {
    fetch: fakeFetch as typeof fetch,
    calls,
    on(method, path, reply) {
      overrides.unshift({ method: method.toUpperCase(), path, reply });
    },
  };
}

export function fakeTx(o: {
  date: string;
  amount: number;
  label: string;
  status?: "BOOK" | "PDNG";
}): EbTransaction {
  return {
    transaction_amount: { amount: Math.abs(o.amount).toFixed(2), currency: "EUR" },
    credit_debit_indicator: o.amount < 0 ? "DBIT" : "CRDT",
    status: o.status ?? "BOOK",
    booking_date: o.date,
    value_date: o.date,
    remittance_information: [o.label],
  };
}

let keyPair: { privateKeyPem: string; publicKey: KeyObject } | null = null;

export function testKeyPair(): { privateKeyPem: string; publicKey: KeyObject } {
  if (!keyPair) {
    const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    keyPair = {
      privateKeyPem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
      publicKey,
    };
  }
  return keyPair;
}

// The config is a singleton shared by test files: seed in beforeAll, clear in afterAll.
export async function seedBankSyncConfig(opts: { enabled?: boolean } = {}): Promise<void> {
  const data = {
    applicationId: "app-test-id",
    privateKeyEnc: encrypt(testKeyPair().privateKeyPem, dataKey),
    enabled: opts.enabled ?? true,
  };
  await db.bankSyncConfig.upsert({
    where: { id: BANK_SYNC_SINGLETON_ID },
    create: { id: BANK_SYNC_SINGLETON_ID, ...data },
    update: data,
  });
}

export async function clearBankSyncConfig(): Promise<void> {
  await db.bankSyncConfig.deleteMany({ where: { id: BANK_SYNC_SINGLETON_ID } });
}

import { createSign } from "node:crypto";
import type {
  EbApplication,
  EbAspsp,
  EbBalance,
  EbSession,
  EbTransaction,
} from "@/server/services/bank-sync/types";

export const ENABLE_BANKING_API = "https://api.enablebanking.com";
export const MAX_TRANSACTION_PAGES = 50;
const REQUEST_TIMEOUT_MS = 30_000;
const JWT_LIFETIME_S = 3600;

export const BANK_SYNC_ERROR_CODES = [
  "EXPIRED_SESSION",
  "RATE_LIMITED",
  "APP_INACTIVE",
  "UNAUTHORIZED",
  "NOT_FOUND",
  "NETWORK",
  "HTTP",
] as const;
export type BankSyncErrorCode = (typeof BANK_SYNC_ERROR_CODES)[number];

// Carries a code only: response bodies echo session ids, account uids and IBANs (design §Security and privacy).
export class EnableBankingError extends Error {
  constructor(
    readonly code: BankSyncErrorCode,
    readonly status: number | null,
  ) {
    super(code);
    this.name = "EnableBankingError";
  }
}

// PSU headers mark a fetch as user-present, which banks exempt from the 4-a-day background limit.
export type Psu = { ip: string | null; userAgent: string | null };

const b64url = (v: string | Buffer) => Buffer.from(v).toString("base64url");

export function signJwt(applicationId: string, privateKeyPem: string, now = new Date()): string {
  const iat = Math.floor(now.getTime() / 1000);
  const head = b64url(JSON.stringify({ typ: "JWT", alg: "RS256", kid: applicationId }));
  const body = b64url(
    JSON.stringify({
      iss: "enablebanking.com",
      aud: "api.enablebanking.com",
      iat,
      exp: iat + JWT_LIFETIME_S,
    }),
  );
  const sig = createSign("RSA-SHA256").update(`${head}.${body}`).sign(privateKeyPem);
  return `${head}.${body}.${b64url(sig)}`;
}

export type EnableBankingClient = {
  application(): Promise<EbApplication>;
  aspsps(country: string): Promise<EbAspsp[]>;
  startAuth(input: {
    aspspName: string;
    country: string;
    validUntil: Date;
    state: string;
    redirectUrl: string;
  }): Promise<{ url: string }>;
  createSession(code: string): Promise<EbSession>;
  deleteSession(sessionId: string): Promise<void>;
  balances(uid: string, psu?: Psu): Promise<EbBalance[]>;
  transactions(uid: string, dateFrom: string, psu?: Psu): Promise<EbTransaction[]>;
  // `truncated`: MAX_TRANSACTION_PAGES was reached with pages left.
  listTransactions(
    uid: string,
    dateFrom: string,
    psu?: Psu,
  ): Promise<{ transactions: EbTransaction[]; truncated: boolean }>;
};

async function errorFields(res: Response): Promise<{ error?: unknown; message?: unknown }> {
  try {
    const body: unknown = await res.json();
    if (body && typeof body === "object") {
      const { error, message } = body as Record<string, unknown>;
      return { error, message };
    }
  } catch {}
  return {};
}

function errorCode(
  status: number,
  body: { error?: unknown; message?: unknown },
): BankSyncErrorCode {
  if (status === 429 || body.error === "ASPSP_RATE_LIMIT_EXCEEDED") return "RATE_LIMITED";
  if (body.error === "EXPIRED_SESSION") return "EXPIRED_SESSION";
  if (status === 401 || status === 403) {
    const inactive =
      typeof body.message === "string" && /application is not active/i.test(body.message);
    return inactive ? "APP_INACTIVE" : "UNAUTHORIZED";
  }
  if (status === 404) return "NOT_FOUND";
  return "HTTP";
}

export function createEnableBankingClient(opts: {
  applicationId: string;
  privateKeyPem: string;
  fetch?: typeof fetch;
  baseUrl?: string;
  now?: () => Date;
}): EnableBankingClient {
  const doFetch = opts.fetch ?? fetch;
  const baseUrl = opts.baseUrl ?? ENABLE_BANKING_API;
  const now = opts.now ?? (() => new Date());

  async function request<T>(
    method: string,
    path: string,
    o: { query?: Record<string, string>; body?: unknown; psu?: Psu } = {},
  ): Promise<T> {
    const url = new URL(path, baseUrl);
    for (const [k, v] of Object.entries(o.query ?? {})) url.searchParams.set(k, v);
    let token: string;
    try {
      token = signJwt(opts.applicationId, opts.privateKeyPem, now());
    } catch {
      throw new EnableBankingError("UNAUTHORIZED", null);
    }
    const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
    if (o.body !== undefined) headers["Content-Type"] = "application/json";
    if (o.psu?.ip) headers["Psu-Ip-Address"] = o.psu.ip;
    if (o.psu?.userAgent) headers["Psu-User-Agent"] = o.psu.userAgent;

    let res: Response;
    try {
      res = await doFetch(url, {
        method,
        headers,
        body: o.body === undefined ? undefined : JSON.stringify(o.body),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch {
      throw new EnableBankingError("NETWORK", null);
    }
    if (!res.ok)
      throw new EnableBankingError(errorCode(res.status, await errorFields(res)), res.status);
    if (method === "DELETE") return undefined as T;
    try {
      return (await res.json()) as T;
    } catch {
      throw new EnableBankingError("HTTP", res.status);
    }
  }

  const list = <T>(rows: T[] | undefined): T[] => {
    if (!Array.isArray(rows)) throw new EnableBankingError("HTTP", null);
    return rows;
  };

  const account = (uid: string, leaf: string) => `/accounts/${encodeURIComponent(uid)}/${leaf}`;

  async function listTransactions(
    uid: string,
    dateFrom: string,
    psu?: Psu,
  ): Promise<{ transactions: EbTransaction[]; truncated: boolean }> {
    const rows: EbTransaction[] = [];
    let key: string | undefined;
    let pages = 0;
    do {
      const query: Record<string, string> = { date_from: dateFrom };
      if (key) query.continuation_key = key;
      const r = await request<{
        transactions: EbTransaction[];
        continuation_key?: string | null;
      }>("GET", account(uid, "transactions"), { query, psu });
      rows.push(...list(r.transactions));
      key = r.continuation_key ?? undefined;
      pages++;
    } while (key && pages < MAX_TRANSACTION_PAGES);
    return { transactions: rows, truncated: Boolean(key) };
  }

  return {
    application: () => request<EbApplication>("GET", "/application"),

    async aspsps(country) {
      const r = await request<{ aspsps: EbAspsp[] }>("GET", "/aspsps", { query: { country } });
      return list(r.aspsps);
    },

    startAuth: (input) =>
      request<{ url: string }>("POST", "/auth", {
        body: {
          access: { valid_until: input.validUntil.toISOString() },
          aspsp: { name: input.aspspName, country: input.country },
          state: input.state,
          redirect_url: input.redirectUrl,
          psu_type: "personal",
        },
      }),

    createSession: (code) => request<EbSession>("POST", "/sessions", { body: { code } }),

    async deleteSession(sessionId) {
      await request<void>("DELETE", `/sessions/${encodeURIComponent(sessionId)}`);
    },

    async balances(uid, psu) {
      const r = await request<{ balances: EbBalance[] }>("GET", account(uid, "balances"), { psu });
      return list(r.balances);
    },

    async transactions(uid, dateFrom, psu) {
      return (await listTransactions(uid, dateFrom, psu)).transactions;
    },

    listTransactions,
  };
}

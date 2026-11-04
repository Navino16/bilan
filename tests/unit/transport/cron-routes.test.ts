import { describe, it, expect, vi, beforeEach } from "vitest";

const env = vi.hoisted(() => ({ CRON_SECRET: "" }));
vi.mock("@/env", () => ({ env }));
const jobs = vi.hoisted(() => ({
  rollRecurringBudgets: vi.fn(async () => ({ checked: 0, rolled: 0 })),
  purgeAuditOlderThan: vi.fn(async () => 0),
  purgeStaleImports: vi.fn(async () => 0),
  purgeExpiredAuthRequests: vi.fn(async () => 0),
  syncDueConnections: vi.fn<(now: Date) => Promise<object>>(async () => ({ due: 0, synced: 0 })),
  sendConsentReminders: vi.fn<(now: Date) => Promise<{ sent: number }>>(async () => ({ sent: 0 })),
  logEvent: vi.fn(),
}));
vi.mock("@/server/services/budgets", () => jobs);
vi.mock("@/server/services/audit", () => jobs);
vi.mock("@/server/services/imports/revert", () => jobs);
vi.mock("@/server/services/bank-sync/connect", () => jobs);
vi.mock("@/server/services/bank-sync/sync", () => jobs);
vi.mock("@/server/services/bank-sync/reminders", () => jobs);

import { POST as rollBudgets } from "@/app/api/cron/roll-budgets/route";
import { POST as purgeAudit } from "@/app/api/cron/purge-audit/route";
import { POST as purgeImports } from "@/app/api/cron/purge-imports/route";
import { POST as bankSync } from "@/app/api/cron/bank-sync/route";

const routes = { rollBudgets, purgeAudit, purgeImports, bankSync };
const call = (route: (req: Request) => Promise<Response>, token?: string) =>
  route(
    new Request("http://localhost/api/cron/x", {
      method: "POST",
      headers: token ? { authorization: `Bearer ${token}` } : {},
    }),
  );

beforeEach(() => vi.clearAllMocks());

describe.each(Object.entries(routes))("cron route %s", (_, route) => {
  it("fails closed with 404 when CRON_SECRET is unset, even with an empty bearer", async () => {
    env.CRON_SECRET = "";
    expect((await call(route)).status).toBe(404);
    expect((await call(route, "")).status).toBe(404);
    expect(Object.values(jobs).some((fn) => fn.mock.calls.length > 0)).toBe(false);
  });

  it("rejects a wrong or missing token with 401", async () => {
    env.CRON_SECRET = "s3cret";
    expect((await call(route)).status).toBe(401);
    expect((await call(route, "nope")).status).toBe(401);
    expect(Object.values(jobs).some((fn) => fn.mock.calls.length > 0)).toBe(false);
  });

  it("runs the job with the right token", async () => {
    env.CRON_SECRET = "s3cret";
    expect((await call(route, "s3cret")).status).toBe(200);
  });
});

it("purges stale imports and expired bank authorization requests", async () => {
  env.CRON_SECRET = "s3cret";
  jobs.purgeStaleImports.mockResolvedValueOnce(2);
  jobs.purgeExpiredAuthRequests.mockResolvedValueOnce(3);
  const res = await call(purgeImports, "s3cret");
  expect(await res.json()).toEqual({ purged: 2, authRequests: 3 });
});

it("runs the due bank syncs and audits their counts", async () => {
  env.CRON_SECRET = "s3cret";
  const counts = { due: 2, synced: 1, rateLimited: 1 };
  jobs.syncDueConnections.mockResolvedValueOnce(counts as never);
  jobs.sendConsentReminders.mockResolvedValueOnce({ sent: 1 });
  const res = await call(bankSync, "s3cret");
  expect(await res.json()).toEqual({ ...counts, reminders: 1 });
  expect(jobs.syncDueConnections).toHaveBeenCalledWith(expect.any(Date));
  expect(jobs.sendConsentReminders).toHaveBeenCalledWith(jobs.syncDueConnections.mock.calls[0][0]);
  expect(jobs.logEvent).toHaveBeenCalledWith({
    userId: null,
    action: "bank_sync.cron",
    metadata: { ...counts, reminders: 1 },
  });
});

it("audits a run that only sent consent reminders", async () => {
  env.CRON_SECRET = "s3cret";
  jobs.sendConsentReminders.mockResolvedValueOnce({ sent: 2 });
  await call(bankSync, "s3cret");
  expect(jobs.logEvent).toHaveBeenCalledWith({
    userId: null,
    action: "bank_sync.cron",
    metadata: { due: 0, synced: 0, reminders: 2 },
  });
});

it("audits a bank sync run only when a connection was due", async () => {
  env.CRON_SECRET = "s3cret";
  await call(bankSync, "s3cret");
  expect(jobs.logEvent).not.toHaveBeenCalled();
});

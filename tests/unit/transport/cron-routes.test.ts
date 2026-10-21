import { describe, it, expect, vi, beforeEach } from "vitest";

const env = vi.hoisted(() => ({ CRON_SECRET: "" }));
vi.mock("@/env", () => ({ env }));
const jobs = vi.hoisted(() => ({
  rollRecurringBudgets: vi.fn(async () => ({ checked: 0, rolled: 0 })),
  purgeAuditOlderThan: vi.fn(async () => 0),
  purgeStaleImports: vi.fn(async () => 0),
  logEvent: vi.fn(),
}));
vi.mock("@/server/services/budgets", () => jobs);
vi.mock("@/server/services/audit", () => jobs);
vi.mock("@/server/services/imports/revert", () => jobs);

import { POST as rollBudgets } from "@/app/api/cron/roll-budgets/route";
import { POST as purgeAudit } from "@/app/api/cron/purge-audit/route";
import { POST as purgeImports } from "@/app/api/cron/purge-imports/route";

const routes = { rollBudgets, purgeAudit, purgeImports };
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

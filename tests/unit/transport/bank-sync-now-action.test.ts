import { beforeEach, describe, expect, it, vi } from "vitest";

const session = vi.hoisted(() => ({ id: "bsn-user" }));
vi.mock("@/server/auth/permissions", () => ({
  requirePermission: async () => session,
  requireSession: async () => session,
}));
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "user-agent": "Test UA" }),
}));
const service = vi.hoisted(() => ({ syncNow: vi.fn() }));
vi.mock("@/server/services/bank-sync/status", () => service);

const { BankSyncError } = await import("@/server/services/bank-sync/errors");
const { syncNowAction } = await import("@/server/transport/actions/bank-sync");

const ok = (imported: number, truncated = false) => ({
  status: "OK",
  accounts: [{ accountId: "acc", imported, skipped: 0, truncated }],
});

describe("syncNowAction", () => {
  beforeEach(() => {
    service.syncNow.mockReset();
    session.id = `bsn-user-${Math.random()}`;
  });

  it("syncs with the request's PSU headers and sums the rows imported", async () => {
    service.syncNow.mockResolvedValue({
      status: "OK",
      accounts: [
        { accountId: "a", imported: 2, skipped: 1, truncated: false },
        { accountId: "b", imported: 3, skipped: 0, truncated: true },
      ],
    });
    expect(await syncNowAction("conn-1")).toEqual({ ok: true, imported: 5, truncated: true });
    expect(service.syncNow).toHaveBeenCalledWith(session.id, "conn-1", {
      ip: null,
      userAgent: "Test UA",
    });
  });

  it("allows one sync per connection every 10 minutes", async () => {
    service.syncNow.mockResolvedValue(ok(1));
    expect(await syncNowAction("conn-1")).toMatchObject({ ok: true });
    expect(await syncNowAction("conn-1")).toEqual({ ok: false, error: "RATE_LIMITED_LOCAL" });
    expect(await syncNowAction("conn-2")).toMatchObject({ ok: true });
    expect(service.syncNow).toHaveBeenCalledTimes(2);
  });

  it("reports a bank error and still counts the attempt", async () => {
    service.syncNow.mockResolvedValue({ status: "FAILED", code: "RATE_LIMITED" });
    expect(await syncNowAction("conn-1")).toEqual({ ok: false, error: "RATE_LIMITED" });
    expect(await syncNowAction("conn-1")).toEqual({ ok: false, error: "RATE_LIMITED_LOCAL" });
  });

  it("gives the slot back when no bank call was made", async () => {
    service.syncNow.mockResolvedValueOnce({ status: "BUSY" });
    expect(await syncNowAction("conn-1")).toEqual({ ok: false, error: "BUSY" });
    service.syncNow.mockRejectedValueOnce(new BankSyncError("NOT_FOUND"));
    expect(await syncNowAction("conn-1")).toEqual({ ok: false, error: "NOT_FOUND" });
    service.syncNow.mockResolvedValueOnce(ok(0));
    expect(await syncNowAction("conn-1")).toEqual({ ok: true, imported: 0, truncated: false });
  });
});

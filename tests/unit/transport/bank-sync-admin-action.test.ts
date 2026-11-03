import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/server/auth/permissions", () => ({
  requirePermission: async () => ({ id: "bs-admin", email: "admin@bilan.local" }),
}));
const service = vi.hoisted(() => ({
  upsertBankSyncConfig: vi.fn(),
  testBankSyncConfig: vi.fn(),
  deleteBankSyncConfig: vi.fn(),
}));
vi.mock("@/server/services/bank-sync/config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/services/bank-sync/config")>();
  return { ...actual, ...service };
});

const { BankSyncConfigError } = await import("@/server/services/bank-sync/config");
const { saveBankSyncConfigAction, testBankSyncConfigAction } =
  await import("@/server/transport/actions/bank-sync");

function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

describe("bank sync admin actions", () => {
  beforeEach(() => {
    for (const fn of Object.values(service)) fn.mockReset();
  });

  it("saves the trimmed application id, the key and the toggle", async () => {
    service.upsertBankSyncConfig.mockResolvedValue({});
    const res = await saveBankSyncConfigAction(
      null,
      form({ applicationId: " app-test-id ", privateKey: "PEM", enabled: "on" }),
    );
    expect(res).toEqual({ ok: true });
    expect(service.upsertBankSyncConfig).toHaveBeenCalledWith(
      { applicationId: "app-test-id", privateKey: "PEM", enabled: true },
      { id: "bs-admin" },
    );
  });

  it("maps key errors to the privateKey field", async () => {
    service.upsertBankSyncConfig.mockRejectedValue(new BankSyncConfigError("INVALID_KEY"));
    expect(
      await saveBankSyncConfigAction(null, form({ applicationId: "app-test-id", privateKey: "x" })),
    ).toEqual({ ok: false, error: "INVALID_KEY", fieldErrors: { privateKey: "INVALID_KEY" } });
  });

  it("asks for an application id without calling the service", async () => {
    const res = await saveBankSyncConfigAction(null, form({ applicationId: " ", privateKey: "" }));
    expect(res).toMatchObject({ ok: false, fieldErrors: { applicationId: "REQUIRED" } });
    expect(service.upsertBankSyncConfig).not.toHaveBeenCalled();
  });

  it("limits the test to 5 a minute", async () => {
    service.testBankSyncConfig.mockResolvedValue({ ok: false, error: "NOT_CONFIGURED" });
    for (let i = 0; i < 5; i++) {
      expect(await testBankSyncConfigAction()).toEqual({ ok: false, error: "NOT_CONFIGURED" });
    }
    expect(await testBankSyncConfigAction()).toEqual({ ok: false, error: "RATE_LIMITED" });
    expect(service.testBankSyncConfig).toHaveBeenCalledTimes(5);
  });
});

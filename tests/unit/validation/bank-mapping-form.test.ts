import { describe, expect, it } from "vitest";
import { parseMappingForm } from "@/lib/schemas/bank-sync";

const form = (fields: Record<string, string>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
};

const today = "2026-11-03";

describe("parseMappingForm", () => {
  it("needs an account to map to", () => {
    expect(parseMappingForm(form({ "a.0.id": "l1", "a.0.action": "MAP" }), today)).toEqual({
      ok: false,
      fieldErrors: { "a.0.accountId": "REQUIRED" },
    });
  });

  it("needs a name for a new account", () => {
    expect(
      parseMappingForm(form({ "a.0.id": "l1", "a.0.action": "CREATE", "a.0.name": "  " }), today),
    ).toEqual({ ok: false, fieldErrors: { "a.0.name": "REQUIRED" } });
  });

  it("refuses a sync-from date in the future or malformed", () => {
    const res = parseMappingForm(
      form({
        "a.0.id": "l1",
        "a.0.action": "MAP",
        "a.0.accountId": "acc1",
        "a.0.syncFrom": "2026-11-04",
        "a.1.id": "l2",
        "a.1.action": "MAP",
        "a.1.accountId": "acc2",
        "a.1.syncFrom": "2026-02-30",
      }),
      today,
    );
    expect(res).toEqual({
      ok: false,
      fieldErrors: { "a.0.syncFrom": "DATE_IN_FUTURE", "a.1.syncFrom": "DATE_INVALID" },
    });
  });

  it("refuses an unknown action", () => {
    expect(parseMappingForm(form({ "a.0.id": "l1", "a.0.action": "DROP" }), today)).toEqual({
      ok: false,
      fieldErrors: { "a.0.action": "INVALID" },
    });
  });

  it("reads a valid three-row form", () => {
    expect(
      parseMappingForm(
        form({
          "a.0.id": "l1",
          "a.0.action": "MAP",
          "a.0.accountId": "acc1",
          "a.0.syncFrom": "2026-11-03",
          "a.1.id": "l2",
          "a.1.action": "CREATE",
          "a.1.name": " Courant Test ",
          "a.1.syncFrom": "",
          "a.2.id": "l3",
          "a.2.action": "IGNORE",
          "a.2.accountId": "ignored",
        }),
        today,
      ),
    ).toEqual({
      ok: true,
      choices: [
        { connectionAccountId: "l1", action: "MAP", accountId: "acc1", syncFrom: "2026-11-03" },
        { connectionAccountId: "l2", action: "CREATE", name: "Courant Test", syncFrom: undefined },
        { connectionAccountId: "l3", action: "IGNORE" },
      ],
    });
  });
});

import { describe, it, expect } from "vitest";
import { addTransactionBlocker, writableActiveAccounts } from "@/lib/onboarding";

describe("addTransactionBlocker", () => {
  it("maps the visible/writable accounts to the reason a user can't add a transaction", () => {
    expect(addTransactionBlocker(false, null)).toBe("NO_ACCOUNT");
    expect(addTransactionBlocker(true, null)).toBe("READ_ONLY");
    expect(addTransactionBlocker(true, { archived: true })).toBe("ARCHIVED");
    expect(addTransactionBlocker(true, { archived: false })).toBeNull();
  });
});

describe("writableActiveAccounts", () => {
  it("keeps owned and WRITE-shared accounts that are not archived", () => {
    const accounts = [
      { id: "owned", access: "OWNER", archived: false },
      { id: "write", access: "WRITE", archived: false },
      { id: "read", access: "READ", archived: false },
      { id: "owned-archived", access: "OWNER", archived: true },
      { id: "write-archived", access: "WRITE", archived: true },
    ];
    expect(writableActiveAccounts(accounts).map((a) => a.id)).toEqual(["owned", "write"]);
  });
});

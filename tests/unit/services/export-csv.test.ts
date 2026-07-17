import { describe, it, expect } from "vitest";
import { transactionsToCsv } from "@/server/services/export/csv";

describe("transactionsToCsv", () => {
  it("writes a header row and one row per transaction with resolved names", () => {
    const csv = transactionsToCsv([
      {
        date: "2026-03-01",
        amount: -12.5,
        type: "CARD",
        label: "Café",
        accountName: "Courant",
        categoryName: "Food",
      },
      {
        date: "2026-03-02",
        amount: 1000,
        type: "TRANSFER",
        label: "Salaire",
        accountName: "Courant",
        categoryName: null,
      },
    ]);
    const lines = csv.trim().split("\n");
    expect(lines[0]).toBe("date,amount,type,label,account,category");
    expect(lines[1]).toContain("2026-03-01");
    expect(lines[1]).toContain("Café");
    expect(lines[2]).toContain("Salaire");
  });
});

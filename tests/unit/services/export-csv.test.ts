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

  it("neutralizes spreadsheet formula injection in text fields", () => {
    const csv = transactionsToCsv([
      {
        date: "2026-03-01",
        amount: -5,
        type: "CARD",
        label: '=HYPERLINK("http://evil","x")',
        accountName: "+cmd",
        categoryName: "@SUM(A1)",
      },
    ]);
    const row = csv.trim().split("\n")[1];
    // Each dangerous field is prefixed with a single quote (quoted by papaparse
    // because it now contains a leading quote char is not required, but the '
    // must be present).
    expect(row).toContain("'=HYPERLINK");
    expect(row).toContain("'+cmd");
    expect(row).toContain("'@SUM(A1)");
  });
});

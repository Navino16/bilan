import { describe, it, expect } from "vitest";
import { transactionsToCsv, type CsvRow } from "@/server/services/export/csv";

const rows: CsvRow[] = [
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
];

function lines(csv: string): string[] {
  return csv
    .replace(/^\uFEFF/, "")
    .trim()
    .split("\n");
}

describe("transactionsToCsv", () => {
  it("starts with a UTF-8 BOM so Excel decodes accents", () => {
    expect(transactionsToCsv(rows, "fr").startsWith("\uFEFF")).toBe(true);
    expect(transactionsToCsv(rows, "en").startsWith("\uFEFF")).toBe(true);
  });

  it("uses `;` and decimal commas with French headers for the fr locale", () => {
    const [header, first, second] = lines(transactionsToCsv(rows, "fr"));
    expect(header).toBe("date;montant;type;libellé;compte;catégorie");
    expect(first).toBe("2026-03-01;-12,50;CARD;Café;Courant;Food");
    expect(second).toBe("2026-03-02;1000,00;TRANSFER;Salaire;Courant;");
  });

  it("uses `,` and decimal dots with English headers for the en locale", () => {
    const [header, first] = lines(transactionsToCsv(rows, "en"));
    expect(header).toBe("date,amount,type,label,account,category");
    expect(first).toBe("2026-03-01,-12.50,CARD,Café,Courant,Food");
  });

  it("quotes text containing the delimiter", () => {
    const [, row] = lines(transactionsToCsv([{ ...rows[0], label: "Resto; bar" }], "fr"));
    expect(row).toContain('"Resto; bar"');
  });

  it("neutralizes spreadsheet formula injection in text fields", () => {
    const row = lines(
      transactionsToCsv(
        [
          {
            date: "2026-03-01",
            amount: -5,
            type: "CARD",
            label: '=HYPERLINK("http://evil","x")',
            accountName: "+cmd",
            categoryName: "@SUM(A1)",
          },
        ],
        "en",
      ),
    )[1];
    expect(row).toContain("'=HYPERLINK");
    expect(row).toContain("'+cmd");
    expect(row).toContain("'@SUM(A1)");
  });
});

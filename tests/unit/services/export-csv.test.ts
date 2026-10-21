import { describe, it, expect } from "vitest";
import { csvHeader, csvLines, transactionsToCsv, type CsvRow } from "@/server/services/export/csv";
import { normalizeType } from "@/server/services/imports/csv-parse";
import { TRANSACTION_TYPES } from "@/lib/validation/transaction";
import fr from "../../../messages/fr.json";
import en from "../../../messages/en.json";

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
  it("writes the same file streamed page by page (#301)", () => {
    for (const locale of ["fr", "en"] as const) {
      const pages = [rows.slice(0, 1), [], rows.slice(1)];
      const streamed = csvHeader(locale) + pages.map((p) => csvLines(p, locale)).join("");
      expect(streamed).toBe(transactionsToCsv(rows, locale));
      expect(csvHeader(locale)).toBe(transactionsToCsv([], locale));
    }
  });

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

  it("writes the localized type labels it is given, and the code otherwise (#245)", () => {
    const frLines = lines(transactionsToCsv(rows, "fr", { CARD: "Carte", TRANSFER: "Virement" }));
    expect(frLines[1]).toBe("2026-03-01;-12,50;Carte;Café;Courant;Food");
    expect(frLines[2]).toBe("2026-03-02;1000,00;Virement;Salaire;Courant;");
    const enLines = lines(transactionsToCsv(rows, "en", { CARD: "Card" }));
    expect(enLines[1]).toBe("2026-03-01,-12.50,Card,Café,Courant,Food");
    expect(enLines[2]).toBe("2026-03-02,1000.00,TRANSFER,Salaire,Courant,");
  });

  it("exports type labels the CSV import reads back (#245)", () => {
    for (const messages of [fr, en]) {
      for (const type of TRANSACTION_TYPES.filter((t) => t !== "OTHER")) {
        expect(normalizeType(messages.transactions.types[type])).toBe(type);
      }
    }
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

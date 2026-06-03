import { describe, it, expect } from "vitest";
import { parseLclItems } from "@/server/services/imports/pdf/lcl";
import type { TextItem } from "@/server/services/imports/pdf/extract";

// Real LCL anchors (4.3a): DATE x≈42, LIBELLE x≈75/197, VALEUR x≈366,
// DEBIT header x=433 (amounts ≈455), CREDIT header x=504 (amounts ≈531).
// Row 1 → credit (+300), row 2 → debit (−93,39); ANCIEN SOLDE has no value date → skipped.
const ITEMS: TextItem[] = [
  { str: "DATE", x: 42, y: 402, page: 1 },
  { str: "LIBELLE", x: 197, y: 402, page: 1 },
  { str: "VALEUR", x: 365, y: 402, page: 1 },
  { str: "DEBIT", x: 433, y: 402, page: 1 },
  { str: "CREDIT", x: 504, y: 402, page: 1 },
  { str: "03.04", x: 42, y: 378, page: 1 },
  { str: "ANCIEN SOLDE", x: 286, y: 378, page: 1 },
  { str: "1 095,88", x: 523, y: 378, page: 1 },
  { str: "07.04", x: 43, y: 354, page: 1 },
  { str: "VIREMENT JOHN DOE", x: 75, y: 354, page: 1 },
  { str: "07.04.26", x: 366, y: 354, page: 1 },
  { str: "300,00", x: 531, y: 354, page: 1 },
  { str: "08.04", x: 43, y: 330, page: 1 },
  { str: "CB SUPERMARKET 02/04/26", x: 75, y: 330, page: 1 },
  { str: "08.04.26", x: 366, y: 330, page: 1 },
  { str: "93,39", x: 458, y: 330, page: 1 },
];

describe("parseLclItems", () => {
  it("pairs rows by y and signs amounts by the DEBIT/CREDIT column anchor", () => {
    expect(parseLclItems(ITEMS)).toEqual([
      { date: new Date("2026-04-07T00:00:00.000Z"), amount: 300, rawLabel: "VIREMENT JOHN DOE" },
      {
        date: new Date("2026-04-08T00:00:00.000Z"),
        amount: -93.39,
        rawLabel: "CB SUPERMARKET 02/04/26",
      },
    ]);
  });

  it("skips the ANCIEN SOLDE row and the header", () => {
    expect(parseLclItems(ITEMS).some((r) => r.rawLabel.includes("SOLDE"))).toBe(false);
  });
});

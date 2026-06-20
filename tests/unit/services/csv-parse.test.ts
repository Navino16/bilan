import { describe, it, expect } from "vitest";
import {
  parseCsv,
  detectMapping,
  normalizeAmount,
  normalizeDate,
  mapRows,
} from "@/server/services/imports/csv-parse";

const SAMPLE = `Date;Libellé;Débit;Crédit
01/02/2026;CB CARREFOUR CITY;42,90;
03/02/2026;VIR SEPA SALAIRE;;2450,00`;

describe("normalizeAmount", () => {
  it("parses fr-formatted amounts with comma decimals and spaces", () => {
    expect(normalizeAmount("1 234,56")).toBe(1234.56);
    expect(normalizeAmount("42,90")).toBe(42.9);
    expect(normalizeAmount("-7.5")).toBe(-7.5);
    expect(normalizeAmount("")).toBeNull();
    expect(normalizeAmount("abc")).toBeNull();
  });

  it("handles thousands separators (grouping is the non-decimal separator)", () => {
    expect(normalizeAmount("1.234,56")).toBe(1234.56); // FR: dot grouping, comma decimal
    expect(normalizeAmount("1,234.56")).toBe(1234.56); // US: comma grouping, dot decimal
    expect(normalizeAmount("-1.234.567,89")).toBe(-1234567.89);
    expect(normalizeAmount("2450")).toBe(2450); // no separator at all
  });
});

describe("normalizeDate", () => {
  it("parses dd/mm/yyyy and ISO into a UTC date", () => {
    expect(normalizeDate("01/02/2026")?.toISOString().slice(0, 10)).toBe("2026-02-01");
    expect(normalizeDate("2026-02-01")?.toISOString().slice(0, 10)).toBe("2026-02-01");
    expect(normalizeDate("not a date")).toBeNull();
  });
});

describe("parseCsv + detectMapping", () => {
  it("parses headers/rows and guesses the column mapping", () => {
    const { headers, rows } = parseCsv(SAMPLE);
    expect(headers).toEqual(["Date", "Libellé", "Débit", "Crédit"]);
    expect(rows).toHaveLength(2);
    const mapping = detectMapping(headers);
    expect(mapping.date).toBe("Date");
    expect(mapping.label).toBe("Libellé");
    // Either an "amount" column, or a debit/credit pair.
    expect(mapping.debit).toBe("Débit");
    expect(mapping.credit).toBe("Crédit");
  });
});

describe("mapRows", () => {
  it("turns raw rows into normalized rows (debit negative, credit positive)", () => {
    const { headers, rows } = parseCsv(SAMPLE);
    const mapping = detectMapping(headers);
    const normalized = mapRows(rows, mapping);
    expect(normalized).toEqual([
      { date: new Date("2026-02-01T00:00:00.000Z"), amount: -42.9, rawLabel: "CB CARREFOUR CITY" },
      { date: new Date("2026-02-03T00:00:00.000Z"), amount: 2450, rawLabel: "VIR SEPA SALAIRE" },
    ]);
  });

  it("drops rows with an unparseable date or amount", () => {
    const rows = [{ Date: "xx", Libellé: "X", Débit: "1", Crédit: "" }];
    const mapping = { date: "Date", label: "Libellé", debit: "Débit", credit: "Crédit" } as const;
    expect(mapRows(rows, mapping)).toEqual([]);
  });

  it("uses the credit when the unused debit column carries a literal zero", () => {
    // Many bank CSVs print "0,00" in the empty column instead of leaving it blank.
    const rows = [{ Date: "03/02/2026", Libellé: "VIR SALAIRE", Débit: "0,00", Crédit: "2450,00" }];
    const mapping = { date: "Date", label: "Libellé", debit: "Débit", credit: "Crédit" } as const;
    expect(mapRows(rows, mapping)).toEqual([
      { date: new Date("2026-02-03T00:00:00.000Z"), amount: 2450, rawLabel: "VIR SALAIRE" },
    ]);
  });
});

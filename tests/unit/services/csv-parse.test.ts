import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  parseCsv,
  decodeCsv,
  detectMapping,
  normalizeAmount,
  normalizeDate,
  normalizeType,
  decimalVote,
  detectDecimalMark,
  detectDateOrder,
  amountCells,
  mapRows,
  looksBinary,
  hasDataRows,
  type RawRow,
} from "@/server/services/imports/csv-parse";
import type { CsvMapping } from "@/server/services/imports/types";
import {
  computeExternalId,
  computeExternalIds,
} from "@/server/services/transactions/secure-fields";

const fixture = (name: string) =>
  decodeCsv(readFileSync(new URL(`../../fixtures/import/${name}`, import.meta.url)));

// The mapping a preview resolves: its decimal mark detected from the amounts.
const resolve = (rows: RawRow[], mapping: CsvMapping, delimiter = ";") => ({
  ...mapping,
  decimal: detectDecimalMark(amountCells(rows, mapping), delimiter).mark,
});

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

  it("rejects impossible calendar dates instead of rolling them over", () => {
    // JS Date would silently turn "31/02/2026" into 2026-03-03.
    expect(normalizeDate("31/02/2026")).toBeNull();
    expect(normalizeDate("32/01/2026")).toBeNull();
    expect(normalizeDate("00/01/2026")).toBeNull();
    expect(normalizeDate("2026-02-31")).toBeNull();
    expect(normalizeDate("2026-13-01")).toBeNull();
    // A real leap day stays valid.
    expect(normalizeDate("29/02/2028")?.toISOString().slice(0, 10)).toBe("2028-02-29");
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

  it("never maps a value-date column to the amount (#255)", () => {
    const mapping = detectMapping(["Date opération", "Date valeur", "Libellé", "Débit", "Crédit"]);
    expect(mapping.date).toBe("Date opération");
    expect(mapping.amount).toBeUndefined();
    expect(mapping.debit).toBe("Débit");
    expect(mapping.credit).toBe("Crédit");
    expect(detectMapping(["Date de valeur", "Libellé", "Montant"]).amount).toBe("Montant");
    expect(detectMapping(["Date", "Libellé", "Valeur"]).amount).toBe("Valeur");
  });

  it("only treats a whole-word date as a date column when picking the amount", () => {
    expect(detectMapping(["Date", "Mandate", "Validated amount"]).amount).toBe("Validated amount");
    expect(detectMapping(["Date", "Libellé", "Date_valeur"]).amount).toBeUndefined();
  });
});

describe("mapRows", () => {
  it("turns raw rows into normalized rows (debit negative, credit positive)", () => {
    const { headers, rows } = parseCsv(SAMPLE);
    const mapping = detectMapping(headers);
    const { rows: normalized } = mapRows(rows, resolve(rows, mapping));
    expect(normalized).toEqual([
      { date: new Date("2026-02-01T00:00:00.000Z"), amount: -42.9, rawLabel: "CB CARREFOUR CITY" },
      { date: new Date("2026-02-03T00:00:00.000Z"), amount: 2450, rawLabel: "VIR SEPA SALAIRE" },
    ]);
  });

  it("reports rows with an unparseable date or amount instead of importing them", () => {
    const rows = [{ Date: "xx", Libellé: "X", Débit: "1", Crédit: "" }];
    const mapping = { date: "Date", label: "Libellé", debit: "Débit", credit: "Crédit" } as const;
    expect(mapRows(rows, { ...mapping, decimal: "," })).toEqual({
      rows: [],
      rejected: [{ row: 2, reason: "DATE", value: "xx" }],
    });
  });

  it("uses the credit when the unused debit column carries a literal zero", () => {
    // Many bank CSVs print "0,00" in the empty column instead of leaving it blank.
    const rows = [{ Date: "03/02/2026", Libellé: "VIR SALAIRE", Débit: "0,00", Crédit: "2450,00" }];
    const mapping = { date: "Date", label: "Libellé", debit: "Débit", credit: "Crédit" } as const;
    expect(mapRows(rows, resolve(rows, mapping)).rows).toEqual([
      { date: new Date("2026-02-03T00:00:00.000Z"), amount: 2450, rawLabel: "VIR SALAIRE" },
    ]);
  });
});

describe("normalizeAmount — bank formats (#157)", () => {
  it("reads currency suffixes, parentheses, trailing minus and plus signs", () => {
    expect(normalizeAmount("(12,34)")).toBe(-12.34);
    expect(normalizeAmount("-12,34 €")).toBe(-12.34);
    expect(normalizeAmount("12,34 EUR")).toBe(12.34);
    expect(normalizeAmount("12,34-")).toBe(-12.34);
    expect(normalizeAmount("+15,00")).toBe(15);
    expect(normalizeAmount("-1\u00a0234,56")).toBe(-1234.56);
  });

  it("reads an ambiguous lone separator as thousands unless the column says otherwise", () => {
    expect(normalizeAmount("1.234")).toBe(1234);
    expect(normalizeAmount("-1,234")).toBe(-1234);
    expect(normalizeAmount("45,500", ",")).toBe(45.5);
    expect(normalizeAmount("1.005", ",")).toBe(1005);
    expect(normalizeAmount("1.234.567")).toBe(1234567);
    expect(normalizeAmount("0,125")).toBe(0.125);
    expect(normalizeAmount("12,5")).toBe(12.5);
  });

  it("rejects malformed groupings and contradictory signs", () => {
    for (const raw of ["1,2,3.4,5", "1,5,3", "12.34.56", "--5", "-5-", "(-5)", "12,", ",5"]) {
      expect(normalizeAmount(raw), raw).toBeNull();
    }
    expect(normalizeAmount("\u221212,34")).toBe(-12.34);
  });

  it("reads a column with the mark its unambiguous values settle", () => {
    const rows = [
      { D: "01/02/2026", L: "A", M: "45,500" },
      { D: "01/02/2026", L: "B", M: "12,5" },
    ];
    const mapping = { date: "D", label: "L", amount: "M" };
    expect(mapRows(rows, resolve(rows, mapping, "\t")).rows.map((r) => r.amount)).toEqual([
      45.5, 12.5,
    ]);
  });
});

describe("decimal mark (#187)", () => {
  it("lets an unambiguous amount vote for its mark", () => {
    expect(decimalVote("1 234,56")).toBe(",");
    expect(decimalVote("12.5")).toBe(".");
    expect(decimalVote("1,234.56")).toBe(".");
    expect(decimalVote("0,125")).toBe(",");
    expect(decimalVote("1234,567")).toBe(",");
    expect(decimalVote("1.234.567")).toBe(",");
    expect(decimalVote("-1,234,567")).toBe(".");
    expect(decimalVote("(12,34)")).toBe(",");
    expect(decimalVote("12,34-")).toBe(",");
    expect(decimalVote("-7.50 €")).toBe(".");
  });

  it("gives no vote for ambiguous, separator-less or non-amount values", () => {
    for (const raw of ["1.234", "-45,500", "12", "", "Réf. 12", "1.234,", "12.34.56"]) {
      expect(decimalVote(raw), raw).toBeNull();
    }
  });

  it("ignores cells that aren't amounts", () => {
    expect(detectDecimalMark(["Réf. 12", "1.234"], ";")).toEqual({ mark: ",", guessed: true });
    expect(detectDecimalMark(["Réf. 12", "N/A"], ";")).toEqual({ mark: ",", guessed: false });
    expect(detectDecimalMark(["1.234,", "45,500"], ",")).toEqual({ mark: ".", guessed: true });
  });

  it("takes the majority of conflicting votes, flagging a guess", () => {
    expect(detectDecimalMark(["0.5", "12,50", "1.234,56"], ";")).toEqual({
      mark: ",",
      guessed: true,
    });
    expect(detectDecimalMark(["0.5", "2.5", "12,50"], ";")).toEqual({ mark: ".", guessed: true });
  });

  it("falls back to the delimiter on a tie, flagging a guess", () => {
    expect(detectDecimalMark(["0.5", "12,50"], ",")).toEqual({ mark: ".", guessed: true });
    expect(detectDecimalMark(["0.5", "12,50"], ";")).toEqual({ mark: ",", guessed: true });
  });

  it("detects from the amounts first, without flagging a guess", () => {
    expect(detectDecimalMark(["1.234", "12,5"], ",")).toEqual({ mark: ",", guessed: false });
    expect(detectDecimalMark(["45,500", "1,234.56"], ";")).toEqual({ mark: ".", guessed: false });
  });

  it("falls back to the delimiter when only ambiguous amounts exist, flagging a guess", () => {
    expect(detectDecimalMark(["1.234", "45,500"], ";")).toEqual({ mark: ",", guessed: true });
    expect(detectDecimalMark(["1.234", "45,500"], ",")).toEqual({ mark: ".", guessed: true });
  });

  it("else keeps ambiguous amounts reading as thousands", () => {
    expect(detectDecimalMark(["1.234", "2.000"], "\t")).toEqual({ mark: ",", guessed: true });
    expect(detectDecimalMark(["45,500"], "\t")).toEqual({ mark: ".", guessed: true });
  });

  it("doesn't flag a guess when no amount carries a separator", () => {
    expect(detectDecimalMark(["12", "-5", ""], ";")).toEqual({ mark: ",", guessed: false });
    expect(detectDecimalMark([], "|")).toEqual({ mark: ",", guessed: false });
  });

  it("reads thousands separators: spaces, NBSP, narrow NBSP, apostrophes", () => {
    expect(normalizeAmount("1 234,56", ",")).toBe(1234.56);
    expect(normalizeAmount("1 234,56", ",")).toBe(1234.56);
    expect(normalizeAmount("-1 234,56", ",")).toBe(-1234.56);
    expect(normalizeAmount("1'234.56", ".")).toBe(1234.56);
    expect(normalizeAmount("1’234’567.89")).toBe(1234567.89);
    expect(normalizeAmount("'-12,50", ",")).toBe(-12.5);
    expect(normalizeAmount("(1 234,50)", ",")).toBe(-1234.5);
  });

  it("rejects apostrophes that don't group thousands", () => {
    for (const raw of ["12'5", "1'2345", "1''234", "'", "12'"]) {
      expect(normalizeAmount(raw, "."), raw).toBeNull();
    }
  });

  it("parses ambiguous amounts with the explicit mark", () => {
    expect(normalizeAmount("1.234", ".")).toBe(1.234);
    expect(normalizeAmount("1.234", ",")).toBe(1234);
    expect(normalizeAmount("45,500", ",")).toBe(45.5);
    expect(normalizeAmount("45,500", ".")).toBe(45500);
    expect(normalizeAmount("-1.234,56", ".")).toBe(-1234.56);
    expect(normalizeAmount("12,5", ".")).toBeNull();
  });

  it("maps rows with the mapping's mark", () => {
    const rows = [
      { D: "01/02/2026", L: "A", M: "45,500" },
      { D: "01/02/2026", L: "B", M: "-1.234" },
    ];
    const read = (decimal: "," | ".") =>
      mapRows(rows, { date: "D", label: "L", amount: "M", decimal }).rows.map((r) => r.amount);
    expect(read(",")).toEqual([45.5, -1234]);
    expect(read(".")).toEqual([45500, -1.23]);
  });

  it("collects amount cells from the signed column or debit + credit", () => {
    const rows = [{ M: "1", Db: "2", Cr: "" }];
    expect(amountCells(rows, { date: "x", label: "y", amount: "M" })).toEqual(["1"]);
    expect(amountCells(rows, { date: "x", label: "y", debit: "Db", credit: "Cr" })).toEqual([
      "2",
      "",
    ]);
  });

  it("returns the delimiter Papa detected", () => {
    expect(parseCsv("a;b\n1;2").delimiter).toBe(";");
    expect(parseCsv(fixture("p-tab.csv")).delimiter).toBe("\t");
  });
});

describe("normalizeDate — more formats (#157)", () => {
  it.each([
    ["22/9/2026", "2026-09-22"],
    ["22/09/26", "2026-09-22"],
    ["2026/09/23", "2026-09-23"],
    ["23.09.2026", "2026-09-23"],
    ["23-09-2026", "2026-09-23"],
    ["2026-09-23 10:15:00", "2026-09-23"],
  ])("%s → %s", (raw, iso) => {
    expect(normalizeDate(raw)?.toISOString().slice(0, 10)).toBe(iso);
  });
});

describe("date order (#245)", () => {
  it("reads slashed dates day-first by default and month-first on request", () => {
    expect(normalizeDate("10/03/2026")?.toISOString().slice(0, 10)).toBe("2026-03-10");
    expect(normalizeDate("10/03/2026", "MDY")?.toISOString().slice(0, 10)).toBe("2026-10-03");
    expect(normalizeDate("3.10.26", "MDY")?.toISOString().slice(0, 10)).toBe("2026-03-10");
    expect(normalizeDate("13/25/2026", "MDY")).toBeNull();
    expect(normalizeDate("12/25/2026", "MDY")?.toISOString().slice(0, 10)).toBe("2026-12-25");
  });

  it("never reorders an ISO date", () => {
    expect(normalizeDate("2026-03-10", "MDY")?.toISOString().slice(0, 10)).toBe("2026-03-10");
  });

  it("detects month-first only when a date can't be day-first and none can't be month-first", () => {
    const order = (values: string[]) => detectDateOrder(values).order;
    expect(order(["10/03/2026", "12/25/2026"])).toBe("MDY");
    expect(order(["12/25/26 10:15", "garbage", ""])).toBe("MDY");
    expect(order(["25/12/2026", "12/25/2026"])).toBe("DMY");
    expect(order(["25/12/2026", "03/10/2026"])).toBe("DMY");
    expect(order(["03/10/2026", "04/11/2026"])).toBe("DMY");
    expect(order(["2026-12-25", "2026-03-10"])).toBe("DMY");
    expect(order([])).toBe("DMY");
  });

  it("flags the date order as guessed only when no date settles it (#255)", () => {
    const guessed = (values: string[]) => detectDateOrder(values).guessed;
    expect(guessed(["03/10/2026", "04/11/2026"])).toBe(true);
    expect(guessed(["03/10/26 10:15", "garbage"])).toBe(true);
    expect(guessed(["03/10/2026", "25/12/2026"])).toBe(false);
    expect(guessed(["03/10/2026", "12/25/2026"])).toBe(false);
    expect(guessed(["01/01/2026", "05/05/2026"])).toBe(false);
    expect(guessed(["2026-03-10", "2026-04-11"])).toBe(false);
    expect(guessed([])).toBe(false);
  });

  it("is applied by mapRows", () => {
    const rows = [{ D: "12/25/2026", L: "GIFT", M: "-3" }];
    const base = { date: "D", label: "L", amount: "M", decimal: "," } as const;
    expect(mapRows(rows, base).rejected.map((r) => r.reason)).toEqual(["DATE"]);
    const out = mapRows(rows, { ...base, dateOrder: "MDY" });
    expect(out.rows[0].date.toISOString().slice(0, 10)).toBe("2026-12-25");
  });
});

describe("normalizeType", () => {
  it("maps a bank's type column", () => {
    expect(normalizeType("Carte bancaire")).toBe("CARD");
    expect(normalizeType("Prélèvement")).toBe("DIRECT_DEBIT");
    expect(normalizeType("VIR")).toBe("TRANSFER");
    expect(normalizeType("Chèque")).toBe("CHEQUE");
    expect(normalizeType("Retrait DAB")).toBe("ATM");
    expect(normalizeType("Divers")).toBeUndefined();
  });

  it("is used when a type column is mapped", () => {
    const rows = [{ Date: "01/02/2026", L: "PAIEMENT", M: "-3", T: "Carte" }];
    expect(
      mapRows(rows, { date: "Date", label: "L", amount: "M", type: "T", decimal: "," }).rows[0]
        .type,
    ).toBe("CARD");
  });
});

describe("fixtures (#157)", () => {
  it("decodes a Windows-1252 file and auto-maps its accented headers", () => {
    const { headers, rows } = parseCsv(fixture("d-cp1252.csv"));
    expect(headers).toContain("Libellé");
    const mapping = detectMapping(headers);
    expect(mapping).toMatchObject({ debit: "Débit", credit: "Crédit" });
    const out = mapRows(rows, resolve(rows, mapping));
    expect(out.rejected).toEqual([]);
    expect(out.rows.map((r) => [r.rawLabel, r.amount])).toEqual([
      ["QA LATIN1 PRÉLÈVEMENT ÉDF", -55],
      ["QA LATIN1 REMISE CHÈQUE", 120],
    ]);
  });

  it("strips the BOM of a UTF-8 file", () => {
    expect(parseCsv(fixture("c-bom-crlf.csv")).headers[0]).toBe("Date");
  });

  it("decodes a UTF-16 file from its BOM", () => {
    const text = "Date;Libellé;Montant\n01/02/2026;CAFÉ;-2,50";
    const le = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, "utf16le")]);
    expect(decodeCsv(le)).toBe(text);
  });

  it("reads tab-separated files", () => {
    const { headers, rows } = parseCsv(fixture("p-tab.csv"));
    expect(mapRows(rows, resolve(rows, detectMapping(headers), "\t")).rows).toHaveLength(1);
  });

  it("reads the tricky rows and reports every rejected one", () => {
    const { headers, rows } = parseCsv(fixture("e-tricky.csv"));
    const out = mapRows(rows, resolve(rows, detectMapping(headers)));
    expect(out.rows.map((r) => r.amount)).toEqual([
      -12.34, -12.34, -12.34, -5, -5, -5, -5, -7, 15, -1234.56,
    ]);
    expect(out.rejected.map((r) => [r.row, r.reason])).toEqual([
      [7, "DATE"],
      [10, "LABEL"],
      [11, "AMOUNT"],
      [14, "AMOUNT_RANGE"],
    ]);
  });
});

describe("computeExternalIds", () => {
  it("keeps identical twins of one file apart, stably across re-imports", () => {
    const coffee = { date: new Date("2026-09-01T00:00:00.000Z"), amount: -2.5, rawLabel: "CAFE" };
    const ids = computeExternalIds([coffee, coffee, { ...coffee, rawLabel: "PAIN" }]);
    expect(new Set(ids).size).toBe(3);
    expect(ids[0]).toBe(computeExternalId(coffee.date, coffee.amount, coffee.rawLabel));
    expect(computeExternalIds([coffee, coffee])).toEqual(ids.slice(0, 2));
  });

  it("treats whitespace variants in one file as twins", () => {
    const d = new Date("2026-01-15");
    const ids = computeExternalIds([
      { date: d, amount: -2.5, rawLabel: "CB  CAFE" },
      { date: d, amount: -2.5, rawLabel: "CB CAFE " },
    ]);
    expect(ids[0]).toBe(computeExternalId(d, -2.5, "CB CAFE"));
    expect(ids[1]).not.toBe(ids[0]);
    expect(
      computeExternalIds([
        { date: d, amount: -2.5, rawLabel: "CB CAFE" },
        { date: d, amount: -2.5, rawLabel: "CB CAFE" },
      ]),
    ).toEqual(ids);
  });
});

describe("looksBinary", () => {
  it("flags images and random bytes renamed .csv", () => {
    const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d]);
    expect(looksBinary(png)).toBe(true);
    const noise = Uint8Array.from({ length: 4096 }, (_, i) => (i * 7919 + 13) % 256);
    expect(looksBinary(noise)).toBe(true);
  });

  it("accepts UTF-8, Latin-1 and UTF-16 (BOM) text", () => {
    expect(looksBinary(new TextEncoder().encode(SAMPLE))).toBe(false);
    expect(
      looksBinary(Uint8Array.from(Buffer.from("Date;Libellé\r\n01/02/2026;CAFÉ", "latin1"))),
    ).toBe(false);
    const utf16 = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(SAMPLE, "utf16le")]);
    expect(looksBinary(Uint8Array.from(utf16))).toBe(false);
  });
});

describe("hasDataRows", () => {
  it("is false for an empty file, a header alone or blank lines", () => {
    expect(hasDataRows("")).toBe(false);
    expect(hasDataRows("Date;Libellé;Montant")).toBe(false);
    expect(hasDataRows("Date;Libellé;Montant\n;;\n\n")).toBe(false);
  });

  it("is true once a line follows the header", () => {
    expect(hasDataRows(SAMPLE)).toBe(true);
  });
});

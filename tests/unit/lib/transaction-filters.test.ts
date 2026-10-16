import { describe, it, expect } from "vitest";
import {
  FILTER_PARAMS,
  UNCATEGORIZED,
  exportTransactionsHref,
  parseTransactionFilters,
  transactionsHref,
} from "@/lib/transaction-filters";

const period = {
  from: new Date(Date.UTC(2026, 2, 1)),
  to: new Date(Date.UTC(2026, 2, 31, 23, 59, 59, 999)),
};

describe("transactionsHref", () => {
  it("links a category over the period and direction", () => {
    expect(transactionsHref("fr", period, { categoryId: "cat1", dir: "out" })).toBe(
      "/fr/transactions?from=2026-03-01&to=2026-03-31&dir=out&categoryId=cat1",
    );
  });

  it("maps the uncategorized bucket to the sentinel", () => {
    const href = transactionsHref("en", period, { categoryId: null, dir: "in" });
    expect(new URL(href, "http://x").searchParams.get("categoryId")).toBe(UNCATEGORIZED);
  });

  it("links a merchant as an encoded search", () => {
    const href = transactionsHref("fr", period, { search: "CARREFOUR CITY", dir: "out" });
    expect(href).toBe(
      "/fr/transactions?from=2026-03-01&to=2026-03-31&dir=out&search=CARREFOUR+CITY",
    );
  });
});

describe("parseTransactionFilters", () => {
  it("defaults to an unfiltered, newest-first list", () => {
    expect(parseTransactionFilters({})).toEqual({ sort: "date-desc" });
  });

  it("keeps the known account, type, direction and sort values", () => {
    expect(
      parseTransactionFilters({
        accountId: "acc1",
        type: "TRANSFER",
        dir: "out",
        sort: "amount-asc",
        categoryId: "cat1",
        search: "loyer",
      }),
    ).toEqual({
      accountId: "acc1",
      type: "TRANSFER",
      direction: "out",
      sort: "amount-asc",
      categoryId: "cat1",
      search: "loyer",
    });
  });

  it("drops unknown types, directions and sorts", () => {
    expect(parseTransactionFilters({ type: "WIRE", dir: "up", sort: "label" })).toEqual({
      sort: "date-desc",
    });
  });

  it("reads amount bounds as absolute values with the strict money parser", () => {
    expect(parseTransactionFilters({ min: "-12,50", max: "1 000" })).toMatchObject({
      amountMin: 12.5,
      amountMax: 1000,
    });
  });

  it("ignores unparseable or ambiguous amounts and orders swapped bounds", () => {
    expect(parseTransactionFilters({ min: "abc", max: "1.234" })).toEqual({ sort: "date-desc" });
    expect(parseTransactionFilters({ min: "100", max: "20" })).toMatchObject({
      amountMin: 20,
      amountMax: 100,
    });
  });

  it("keeps only valid calendar days", () => {
    expect(parseTransactionFilters({ from: "2026-13-45", to: "2026-03-31" })).toEqual({
      sort: "date-desc",
      to: "2026-03-31",
    });
  });
});

describe("FILTER_PARAMS", () => {
  it("lists every param the reset button clears, but not the search", () => {
    expect([...FILTER_PARAMS].sort()).toEqual(
      ["accountId", "categoryId", "dir", "from", "max", "min", "sort", "to", "type"].sort(),
    );
  });
});

describe("exportTransactionsHref", () => {
  it("exports everything in the locale when no filter is set", () => {
    expect(exportTransactionsHref("fr", {})).toBe("/api/export/transactions?locale=fr");
    expect(exportTransactionsHref("en", { from: "", to: "", accountId: "" })).toBe(
      "/api/export/transactions?locale=en",
    );
  });

  it("carries the date range and the account the export route reads", () => {
    const href = exportTransactionsHref("fr", {
      from: "2026-01-01",
      to: "2026-03-31",
      accountId: "acc1",
    });
    expect(href).toBe(
      "/api/export/transactions?locale=fr&from=2026-01-01&to=2026-03-31&accountId=acc1",
    );
    const q = Object.fromEntries(new URL(href, "http://x").searchParams);
    expect(parseTransactionFilters(q)).toMatchObject({
      from: "2026-01-01",
      to: "2026-03-31",
      accountId: "acc1",
    });
  });

  it("accepts an open-ended range", () => {
    expect(exportTransactionsHref("fr", { from: "2026-01-01" })).toBe(
      "/api/export/transactions?locale=fr&from=2026-01-01",
    );
  });
});

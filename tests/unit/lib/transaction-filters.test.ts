import { describe, it, expect } from "vitest";
import { UNCATEGORIZED, transactionsHref } from "@/lib/transaction-filters";

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

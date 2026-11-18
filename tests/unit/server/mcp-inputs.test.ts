import { describe, it, expect } from "vitest";
import { comparisonFor, dayEnd, dayStart, monthPeriod, presetPeriod } from "@/lib/period";
import { McpToolError } from "@/server/mcp/errors";
import {
  periodInput,
  searchInput,
  toComparison,
  toPeriod,
  toTransactionFilters,
} from "@/server/mcp/tools/inputs";

const now = new Date("2026-11-18T10:00:00.000Z");

function codeOf(fn: () => unknown): string | null {
  try {
    fn();
    return null;
  } catch (e) {
    return e instanceof McpToolError ? e.code : "OTHER";
  }
}

describe("toPeriod", () => {
  it("resolves a preset", () => {
    expect(toPeriod({ preset: "last-month" }, now)).toEqual(presetPeriod("last-month", now));
  });

  it("resolves a from/to range, a whole month becoming a month period", () => {
    expect(toPeriod({ from: "2026-10-01", to: "2026-10-31" }, now)).toEqual(monthPeriod(2026, 10));
    expect(toPeriod({ from: "2026-10-05", to: "2026-10-20" }, now)).toEqual({
      from: dayStart("2026-10-05"),
      to: dayEnd("2026-10-20"),
      year: null,
      month: null,
    });
  });

  it("rejects a reversed range, an impossible day and a preset mixed with a range", () => {
    expect(codeOf(() => toPeriod({ from: "2026-10-31", to: "2026-10-01" }, now))).toBe(
      "INVALID_PERIOD",
    );
    expect(codeOf(() => toPeriod({ from: "2026-13-01" }, now))).toBe("INVALID_PERIOD");
    expect(codeOf(() => toPeriod({ from: "2026-10-01", to: "2026-02-30" }, now))).toBe(
      "INVALID_PERIOD",
    );
    expect(codeOf(() => toPeriod({ preset: "this-month", from: "2026-10-01" }, now))).toBe(
      "INVALID_PERIOD",
    );
  });

  it("defaults to the current month", () => {
    expect(toPeriod({}, now)).toEqual(monthPeriod(2026, 11));
    expect(toPeriod(undefined, now)).toEqual(monthPeriod(2026, 11));
  });

  it("accepts only the known presets", () => {
    expect(periodInput.safeParse({ preset: "next-decade" }).success).toBe(false);
  });

  it("rejects unknown keys instead of dropping them", () => {
    expect(periodInput.safeParse({ start: "2026-10-01" }).success).toBe(false);
  });
});

describe("toComparison", () => {
  it("uses the requested baseline on a month, the fallback when none is given", () => {
    const month = monthPeriod(2026, 10);
    expect(toComparison(month, "avg6", "prev", now)).toEqual(comparisonFor(month, "avg6", now));
    expect(toComparison(month, undefined, "avg3", now)).toEqual(comparisonFor(month, "avg3", now));
  });

  it("falls back to prev on a custom range (averages need whole months)", () => {
    const range = toPeriod({ from: "2026-10-05", to: "2026-10-20" }, now);
    expect(toComparison(range, "avg3", "avg3", now).baseline).toBe("prev");
  });
});

describe("searchInput", () => {
  it("defaults take to 100 and skip to 0", () => {
    expect(searchInput.parse({})).toMatchObject({ take: 100, skip: 0 });
  });

  it("rejects take outside 1–1000 and a negative skip", () => {
    expect(searchInput.safeParse({ take: 0 }).success).toBe(false);
    expect(searchInput.safeParse({ take: 1001 }).success).toBe(false);
    expect(searchInput.safeParse({ take: 1000 }).success).toBe(true);
    expect(searchInput.safeParse({ skip: -1 }).success).toBe(false);
  });

  it("rejects a misspelled filter instead of dropping it", () => {
    expect(searchInput.safeParse({ category: "c1" }).success).toBe(false);
  });

  it("maps day bounds to inclusive UTC instants and rejects invalid ones", () => {
    const filters = toTransactionFilters(
      searchInput.parse({ from: "2026-10-01", to: "2026-10-31", search: "shop" }),
    );
    expect(filters).toMatchObject({
      from: dayStart("2026-10-01"),
      to: dayEnd("2026-10-31"),
      search: "shop",
      take: 100,
      skip: 0,
    });
    expect(codeOf(() => toTransactionFilters(searchInput.parse({ from: "2026-10-32" })))).toBe(
      "INVALID_PERIOD",
    );
    expect(
      codeOf(() =>
        toTransactionFilters(searchInput.parse({ from: "2026-10-31", to: "2026-10-01" })),
      ),
    ).toBe("INVALID_PERIOD");
  });
});

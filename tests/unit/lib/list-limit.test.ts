import { describe, it, expect } from "vitest";
import {
  LIST_PAGE_SIZE,
  LIST_MAX_LIMIT,
  parseListLimit,
  nextListLimit,
  trimToDayBoundary,
} from "@/lib/list-limit";

describe("parseListLimit", () => {
  it("defaults to one page when absent or invalid", () => {
    expect(parseListLimit(undefined)).toBe(LIST_PAGE_SIZE);
    expect(parseListLimit("")).toBe(LIST_PAGE_SIZE);
    expect(parseListLimit("abc")).toBe(LIST_PAGE_SIZE);
    expect(parseListLimit("12.5")).toBe(LIST_PAGE_SIZE);
    expect(parseListLimit("0")).toBe(LIST_PAGE_SIZE);
    expect(parseListLimit("-5")).toBe(LIST_PAGE_SIZE);
  });

  it("accepts a positive integer and caps it", () => {
    expect(parseListLimit("5")).toBe(5);
    expect(parseListLimit("300")).toBe(300);
    expect(parseListLimit("99999")).toBe(LIST_MAX_LIMIT);
  });
});

describe("nextListLimit", () => {
  it("adds one page, capped", () => {
    expect(nextListLimit(100)).toBe(200);
    expect(nextListLimit(5)).toBe(105);
    expect(nextListLimit(LIST_MAX_LIMIT - 20)).toBe(LIST_MAX_LIMIT);
  });
});

describe("trimToDayBoundary", () => {
  const row = (id: string, date: string) => ({ id, date: `${date}T00:00:00.000Z` });

  it("keeps everything when the list is complete", () => {
    const items = [row("a", "2026-03-02"), row("b", "2026-03-01")];
    expect(trimToDayBoundary(items, false)).toEqual({ items, partialLastDay: false });
  });

  it("drops the trailing, possibly incomplete day when truncated", () => {
    const items = [row("a", "2026-03-02"), row("b", "2026-03-01"), row("c", "2026-03-01")];
    expect(trimToDayBoundary(items, true)).toEqual({
      items: [items[0]],
      partialLastDay: false,
    });
  });

  it("keeps a single truncated day but flags it as partial", () => {
    const items = [row("a", "2026-03-01"), row("b", "2026-03-01")];
    expect(trimToDayBoundary(items, true)).toEqual({ items, partialLastDay: true });
  });

  it("handles an empty list", () => {
    expect(trimToDayBoundary([], true)).toEqual({ items: [], partialLastDay: false });
  });
});

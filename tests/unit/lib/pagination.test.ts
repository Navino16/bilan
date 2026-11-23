import { describe, it, expect } from "vitest";
import { pageWindow, parsePage } from "@/lib/pagination";

describe("parsePage", () => {
  it("defaults to 1 for absent, invalid or zero values", () => {
    for (const raw of [undefined, "", "abc", "-2", "1.5", "0"]) expect(parsePage(raw)).toBe(1);
  });

  it("reads a positive integer", () => {
    expect(parsePage("7")).toBe(7);
  });
});

describe("pageWindow", () => {
  it("computes the page count and the offset", () => {
    expect(pageWindow(4911, 3, 50)).toEqual({ page: 3, pageCount: 99, skip: 100 });
  });

  it("clamps a page past the end to the last one", () => {
    expect(pageWindow(120, 9, 50)).toEqual({ page: 3, pageCount: 3, skip: 100 });
  });

  it("keeps a single page for an empty list", () => {
    expect(pageWindow(0, 4, 50)).toEqual({ page: 1, pageCount: 1, skip: 0 });
  });
});

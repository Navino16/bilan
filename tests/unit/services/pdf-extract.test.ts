import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import { extractItems, extractText, pageText } from "@/server/services/imports/pdf/extract";

const viewport = { convertToViewportPoint: (x: number, y: number) => [x, 800 - y] };

function item(str: string, x: number, y: number, opts: { width?: number; hasEOL?: boolean } = {}) {
  return {
    str,
    transform: [10, 0, 0, 10, x, y],
    width: opts.width ?? 30,
    height: 10,
    hasEOL: opts.hasEOL ?? false,
    dir: "ltr",
    fontName: "f1",
  };
}

describe("pageText", () => {
  it("separates distant cells with a tab and breaks lines on a y jump", () => {
    const items = [
      item("01/02", 10, 700),
      item("ACME", 60, 700),
      item("-12,34", 95, 700),
      item("03/02", 10, 680),
    ];
    expect(pageText(viewport, items)).toBe("01/02\tACME-12,34\n03/02");
  });

  it("does not add a second line break after an end-of-line item", () => {
    expect(pageText(viewport, [item("A", 10, 700, { hasEOL: true }), item("B", 10, 680)])).toBe(
      "A\nB",
    );
  });

  it("keeps a small vertical offset within the line height on the same line", () => {
    expect(pageText(viewport, [item("A", 10, 700), item("B", 40, 694)])).toBe("AB");
  });
});

describe("extractText / extractItems", () => {
  const pdf = readFileSync("tests/e2e/fixtures/statement.pdf");

  it("matches the pdf-parse@2 text layout, page footer included", async () => {
    expect(await extractText(pdf)).toBe(
      "RELEVE DE TEST\n01/02/2026 ACME STORE -12,34\n03/02/2026 SALARY 2450,00\n" +
        "05/02/2026 COFFEE SHOP -4,50\n\n-- 1 of 1 --\n\n",
    );
  });

  it("returns trimmed positioned items with their page", async () => {
    const items = await extractItems(pdf);
    expect(items).toHaveLength(4);
    expect(items[0]).toMatchObject({ str: "RELEVE DE TEST", page: 1 });
  });
});

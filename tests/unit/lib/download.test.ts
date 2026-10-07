import { describe, it, expect } from "vitest";
import { filenameFromDisposition } from "@/lib/download";

describe("filenameFromDisposition", () => {
  it("reads a quoted and an unquoted filename", () => {
    expect(
      filenameFromDisposition('attachment; filename="bilan-data-export-2026-10-07.json"', "x"),
    ).toBe("bilan-data-export-2026-10-07.json");
    expect(filenameFromDisposition("attachment; filename=a.csv", "x")).toBe("a.csv");
  });

  it("does not stop a quoted filename at a semicolon and unescapes quoted-pairs", () => {
    expect(filenameFromDisposition('attachment; filename="a;b.csv"', "x")).toBe("a;b.csv");
    expect(filenameFromDisposition('attachment; filename="say \\"hi\\".csv"', "x")).toBe(
      'say "hi".csv',
    );
  });

  it("never percent-decodes a plain filename", () => {
    expect(filenameFromDisposition("attachment; filename=100%25.csv", "x")).toBe("100%25.csv");
  });

  it("decodes a UTF-8 filename* and prefers it over filename", () => {
    expect(filenameFromDisposition("attachment; filename*=UTF-8''donn%C3%A9es.csv", "x")).toBe(
      "données.csv",
    );
    expect(
      filenameFromDisposition(
        "attachment; filename=\"plain.csv\"; filename*=utf-8'fr'donn%C3%A9es.csv",
        "x",
      ),
    ).toBe("données.csv");
  });

  it("returns a non-UTF-8 filename* value raw", () => {
    expect(filenameFromDisposition("attachment; filename*=iso-8859-1'en'%A3rates.csv", "x")).toBe(
      "%A3rates.csv",
    );
  });

  it("falls back to filename when filename* is malformed", () => {
    expect(
      filenameFromDisposition('attachment; filename*=no-quotes.csv; filename="ok.csv"', "x"),
    ).toBe("ok.csv");
  });

  it("falls back when the header is missing or has no filename", () => {
    expect(filenameFromDisposition(null, "fallback.csv")).toBe("fallback.csv");
    expect(filenameFromDisposition("attachment", "fallback.csv")).toBe("fallback.csv");
  });
});

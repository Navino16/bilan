import { describe, it, expect } from "vitest";
import { parseGenericText } from "@/server/services/imports/pdf/generic";

describe("parseGenericText", () => {
  it("best-effort extracts <dd/mm/yyyy> <label> <amount> lines, sign as printed", () => {
    const rows = parseGenericText("01/02/2026 ACME STORE -12,34\n03/02/2026 SALARY 2 450,00\nheader line");
    expect(rows).toEqual([
      { date: new Date("2026-02-01T00:00:00.000Z"), amount: -12.34, rawLabel: "ACME STORE" },
      { date: new Date("2026-02-03T00:00:00.000Z"), amount: 2450, rawLabel: "SALARY" },
    ]);
  });
});

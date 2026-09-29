import { describe, it, expect } from "vitest";
import { canCommit, canDiscard, canRevert, trimBatchMetadata } from "@/lib/import-status";

describe("import status guards", () => {
  it("commits only a batch in review", () => {
    expect(canCommit("REVIEW")).toBe(true);
    for (const s of ["PARSING", "COMPLETED", "REVERTED", "FAILED"])
      expect(canCommit(s)).toBe(false);
  });

  it("reverts only a completed batch", () => {
    expect(canRevert("COMPLETED")).toBe(true);
    for (const s of ["PARSING", "REVIEW", "REVERTED", "FAILED"]) expect(canRevert(s)).toBe(false);
  });

  it("discards only uncommitted batches", () => {
    for (const s of ["PARSING", "REVIEW", "FAILED"]) expect(canDiscard(s)).toBe(true);
    for (const s of ["COMPLETED", "REVERTED"]) expect(canDiscard(s)).toBe(false);
  });
});

describe("trimBatchMetadata", () => {
  it("drops the raw CSV text", () => {
    expect(trimBatchMetadata({ text: "a;b", fileSizeBytes: 3 }, ["acc1"])).toEqual({
      fileSizeBytes: 3,
      accountIds: ["acc1"],
    });
  });

  it("drops the parsed PDF rows but keeps the bank", () => {
    const meta = { bank: "revolut", products: [{ key: "x", rows: [] }], fileSizeBytes: 9 };
    expect(trimBatchMetadata(meta, ["a", "b"])).toEqual({
      fileSizeBytes: 9,
      bank: "revolut",
      accountIds: ["a", "b"],
    });
  });

  it("tolerates missing metadata", () => {
    expect(trimBatchMetadata(null, [])).toEqual({ fileSizeBytes: null, accountIds: [] });
  });
});

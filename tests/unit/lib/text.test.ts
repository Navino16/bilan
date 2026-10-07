import { describe, it, expect } from "vitest";
import { foldDiacritics, hasUnsearchableWord, tokenize } from "@/lib/text";

describe("text helpers", () => {
  it("folds accents", () => {
    expect(foldDiacritics("Crème brûlée à l'Été")).toBe("Creme brulee a l'Ete");
  });

  it("tokenizes into distinct normalized words of 3+ chars", () => {
    expect(tokenize("CB Crème CREME 42 lid")).toEqual(["creme", "lid"]);
  });

  it("flags queries holding a word too short for the token index", () => {
    expect(hasUnsearchableWord("cb")).toBe(true);
    expect(hasUnsearchableWord("cb carrefour")).toBe(true);
    expect(hasUnsearchableWord("carrefour city")).toBe(false);
    expect(hasUnsearchableWord("  ")).toBe(false);
  });
});

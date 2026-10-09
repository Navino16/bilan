import { describe, it, expect } from "vitest";
import {
  foldDiacritics,
  hasUnsearchableWord,
  MAX_SEARCH_PREFIX,
  searchPrefixes,
  searchQueryTerms,
  tokenize,
} from "@/lib/text";

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

  it("indexes every prefix of 3+ chars of each word", () => {
    expect(searchPrefixes("CB Lidl")).toEqual(["lid", "lidl"]);
    expect(searchPrefixes("Épicerie")).toEqual([
      "epi",
      "epic",
      "epice",
      "epicer",
      "epiceri",
      "epicerie",
    ]);
  });

  it("skips short words and dedupes prefixes shared across words", () => {
    expect(searchPrefixes("cb 42 lid")).toEqual(["lid"]);
    expect(searchPrefixes("Lidl LIDL lido")).toEqual(["lid", "lidl", "lido"]);
    expect(searchPrefixes("ab")).toEqual([]);
  });

  it("caps prefixes at MAX_SEARCH_PREFIX chars for long words", () => {
    const word = "remboursements";
    const prefixes = searchPrefixes(word);
    expect(MAX_SEARCH_PREFIX).toBe(12);
    expect(prefixes).toHaveLength(MAX_SEARCH_PREFIX - 2);
    expect(prefixes.at(-1)).toBe("remboursemen");
    expect(prefixes).not.toContain(word);
  });

  it("indexes 10 prefixes for words of 12 and 13 chars alike", () => {
    const twelve = "telephonique";
    const thirteen = "remboursement";
    expect(searchPrefixes(twelve)).toHaveLength(10);
    expect(searchPrefixes(twelve)).toContain(twelve);
    expect(searchPrefixes(thirteen)).toHaveLength(10);
    expect(searchPrefixes(thirteen)).not.toContain(thirteen);
    expect(searchPrefixes(thirteen)).toContain(searchQueryTerms(thirteen)[0]);
  });

  it("maps a query to one term per searchable word, cut to the prefix cap", () => {
    expect(searchQueryTerms("CB Lid")).toEqual(["lid"]);
    expect(searchQueryTerms("Épic lidl épic")).toEqual(["epic", "lidl"]);
    expect(searchQueryTerms("Remboursements")).toEqual(["remboursemen"]);
    expect(searchQueryTerms("cb")).toEqual([]);
  });
});

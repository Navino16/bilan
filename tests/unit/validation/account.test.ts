import { describe, it, expect } from "vitest";
import { confirmsAccountName } from "@/lib/validation/account";

describe("confirmsAccountName", () => {
  it("accepts the exact name, ignoring surrounding spaces", () => {
    expect(confirmsAccountName("  Livret A ", "Livret A")).toBe(true);
  });

  it("is case-sensitive and rejects partial or empty input", () => {
    expect(confirmsAccountName("livret a", "Livret A")).toBe(false);
    expect(confirmsAccountName("Livret", "Livret A")).toBe(false);
    expect(confirmsAccountName("", "Livret A")).toBe(false);
  });

  it("matches accents typed in decomposed form", () => {
    expect(confirmsAccountName("Épargne", "Épargne")).toBe(true);
  });

  it("matches the typographic apostrophe iOS inserts", () => {
    expect(confirmsAccountName("Livret d’épargne", "Livret d'épargne")).toBe(true);
    expect(confirmsAccountName("Livret d'épargne", "Livret d‘épargne")).toBe(true);
  });

  it("treats non-breaking and repeated spaces as one space", () => {
    expect(confirmsAccountName("Compte joint", "Compte joint")).toBe(true);
    expect(confirmsAccountName("Compte  joint", "Compte joint")).toBe(true);
    expect(confirmsAccountName("Comptejoint", "Compte joint")).toBe(false);
  });
});

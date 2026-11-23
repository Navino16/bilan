import { describe, it, expect } from "vitest";
import { normalizeIban, isValidIban, maskIban, formatIban } from "@/server/services/accounts/iban";

describe("normalizeIban", () => {
  it("removes spaces and uppercases", () => {
    expect(normalizeIban(" fr76 3000 6000 01 ")).toBe("FR7630006000 01".replace(/\s/g, ""));
    expect(normalizeIban("fr7630006000011234567890189")).toBe("FR7630006000011234567890189");
  });
});

describe("isValidIban", () => {
  it("accepts a valid IBAN (mod-97 == 1)", () => {
    expect(isValidIban("FR7630006000011234567890189")).toBe(true);
    expect(isValidIban("DE89 3704 0044 0532 0130 00")).toBe(true);
  });
  it("rejects bad checksum, bad length, and non-alphanumerics", () => {
    expect(isValidIban("FR7630006000011234567890188")).toBe(false); // wrong check digits
    expect(isValidIban("FR76")).toBe(false); // too short
    expect(isValidIban("FR76!@#$")).toBe(false);
  });
});

describe("maskIban", () => {
  it("shows only the last 4 chars", () => {
    expect(maskIban("FR7630006000011234567890189")).toBe("•••• 0189");
  });
});

describe("formatIban", () => {
  it("groups in blocks of 4 and normalizes input", () => {
    expect(formatIban("fr7630006000011234567890189")).toBe("FR76 3000 6000 0112 3456 7890 189");
  });
});

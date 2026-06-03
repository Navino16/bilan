import { describe, it, expect } from "vitest";
import { detectBank } from "@/server/services/imports/pdf/detect";

describe("detectBank", () => {
  it("detects Revolut from the issuer fingerprint", () => {
    expect(detectBank("… Revolut Bank UAB est un établissement de crédit …")).toBe("revolut");
  });
  it("detects LCL from the BIC / bank name", () => {
    expect(detectBank("… BIC : CRLYFRPP … RELEVE DE COMPTE …")).toBe("lcl");
    expect(detectBank("CREDIT LYONNAIS\nNANTES BOILEAU")).toBe("lcl");
  });
  it("returns null for an unknown bank", () => {
    expect(detectBank("Generic statement from Some Other Bank")).toBeNull();
  });
});

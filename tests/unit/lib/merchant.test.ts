import { describe, it, expect } from "vitest";
import { merchantKey, merchantLabel } from "@/lib/merchant";

describe("merchantKey", () => {
  it.each([
    ["CB SUPERMARKET 02/04/26", "SUPERMARKET"],
    ["CB AMAZON EU 42,99", "AMAZON EU"],
    ["CB CARREFOUR CITY PARIS", "CARREFOUR CITY PARIS"],
    ["PRLV SEPA SFR", "SFR"],
    ["PRLV EDF ENERGIE", "EDF ENERGIE"],
    ["VIR SEPA SALAIRE", "SALAIRE"],
    ["VIREMENT JOHN DOE", "JOHN DOE"],
    ["PAIEMENT PAR CARTE FNAC 12/03", "FNAC"],
    ["CARTE X1234 12/03 CARREFOUR", "CARREFOUR"],
    ["cb  Café   de la Gare", "CAFE DE LA GARE"],
    ["Paiement reçu de JOHN DOE", "PAIEMENT RECU DE JOHN DOE"],
  ])("%s → %s", (label, key) => {
    expect(merchantKey(label)).toBe(key);
  });

  it("returns an empty key when only a prefix and a date are left", () => {
    expect(merchantKey("CB 12/03")).toBe("");
  });

  it("groups variants of the same merchant", () => {
    expect(merchantKey("CB LIDL 03/08/26")).toBe(merchantKey("CB LIDL 17/08/26 CARTE 4"));
  });
});

describe("merchantLabel", () => {
  it("strips like the key but keeps the casing", () => {
    expect(merchantLabel("cb  Café de la Gare 12/03")).toBe("Café de la Gare");
  });
});

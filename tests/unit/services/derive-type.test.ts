import { describe, it, expect } from "vitest";
import { deriveType } from "@/server/services/imports/derive-type";

describe("deriveType", () => {
  it("maps French bank label prefixes to transaction types", () => {
    expect(deriveType("CB CARREFOUR CITY")).toBe("CARD");
    expect(deriveType("PRLV SEPA SFR")).toBe("DIRECT_DEBIT");
    expect(deriveType("PRÉLÈVEMENT EDF")).toBe("DIRECT_DEBIT");
    expect(deriveType("ECHEANCE PRET PERSONNEL")).toBe("DIRECT_DEBIT");
    expect(deriveType("VIR SEPA SALAIRE")).toBe("TRANSFER");
    expect(deriveType("VIREMENT MME JAUNET")).toBe("TRANSFER");
    expect(deriveType("CHEQUE N°123")).toBe("CHEQUE");
    expect(deriveType("RETRAIT DAB")).toBe("ATM");
    expect(deriveType("Paiement reçu de JOHN DOE")).toBe("OTHER");
    expect(deriveType("")).toBe("OTHER");
  });
});

import { describe, expect, it } from "vitest";
import { normalizeBankLabel } from "@/server/services/bank-sync/labels";

// LCL sends one remittance string of 7 lines: family, card/cheque number, statement label, details.
const lcl = (...lines: string[]) =>
  [...lines, ...Array(7 - lines.length).fill("")].slice(0, 7).join("\n");
const norm = (raw: string) => normalizeBankLabel(raw, "LCL");

describe("normalizeBankLabel — LCL lines", () => {
  it("keeps the statement line of a card payment, without card number or cardholder", () => {
    const out = norm(lcl("CARTE", "1234567", "CB  CAFE DU PORT 05/10/26", "JEAN DUPONT"));
    expect(out).toBe("CB  CAFE DU PORT 05/10/26");
    expect(out).not.toMatch(/1234567|DUPONT/);
  });

  it("drops the exchange details of a foreign card payment", () => {
    const raw = lcl(
      "CARTE",
      "1234567",
      "CB  SHOP*ONLINE 05/10/26",
      "USD 12,50 EUR 11,52",
      "JEAN DUPONT",
    );
    expect(norm(raw)).toBe("CB  SHOP*ONLINE 05/10/26");
  });

  it("handles a card refund", () => {
    const raw = lcl(
      "CARTE X./Y.",
      "1234567",
      "CB  SHOP MODE 03/10/26",
      "CREDIT EUR 25,00 Z",
      "CREDIT",
      "JEAN DUPONT",
    );
    expect(norm(raw)).toBe("CB  SHOP MODE 03/10/26");
  });

  it("keeps the statement line of a cash withdrawal", () => {
    expect(norm(lcl("RETRAIT DAB", "1234567", "CB RETRAIT DU 05/10", "VILLE TEST"))).toBe(
      "CB RETRAIT DU 05/10",
    );
  });

  it("keeps the statement line of an outgoing SEPA transfer", () => {
    const raw = lcl("VIREMENT", "", "VIR SEPA LOYER OCTOBRE", "", "", "", "R123456789012");
    expect(norm(raw)).toBe("VIR SEPA LOYER OCTOBRE");
  });

  it("keeps the statement line of an incoming SEPA transfer", () => {
    const raw = lcl(
      "VIREMENT SEPA RECU",
      "",
      "VIREMENT ACME PAYROLL",
      "SALAIRE OCTOBRE",
      "",
      "",
      "R123A12345678",
    );
    expect(norm(raw)).toBe("VIREMENT ACME PAYROLL");
  });

  it("keeps the statement line of an instant transfer", () => {
    const raw = lcl(
      "VIREMENT INSTANTANE",
      "",
      "VIR INST JANE DOE",
      "REMBOURSEMENT",
      "",
      "",
      "R123456789012",
    );
    expect(norm(raw)).toBe("VIR INST JANE DOE");
  });

  it("keeps the statement line of a SEPA direct debit, without mandate references", () => {
    const raw = lcl(
      "AVIS SEPA RECU EM/CR TEST",
      "",
      "PRLV SEPA ENERGIE TEST",
      "ID.FR12ZZZ123456",
      ".MDT.ABC123456",
      "",
      "R123456789012",
    );
    expect(norm(raw)).toBe("PRLV SEPA ENERGIE TEST");
  });

  it("keeps the statement line of fees and loan instalments", () => {
    expect(norm(lcl("COTISATION OFFRE CARTE", "", "COTISATION OFFRE CARTE 0001"))).toBe(
      "COTISATION OFFRE CARTE 0001",
    );
    expect(norm(lcl("FRAIS TENUE COMPTE", "", "FRAIS TENUE COMPTE", "DU 01/09 AU 30/09"))).toBe(
      "FRAIS TENUE COMPTE",
    );
    expect(
      norm(lcl("PRELEVEMENT DES ECHEANCES", "", "ECHEANCE PRET 123456", "12345678901234A12")),
    ).toBe("ECHEANCE PRET 123456");
  });

  it("builds a cheque label from its number", () => {
    expect(norm(lcl("CHEQUE", "N. 1234567"))).toBe("CHEQUE 1234567");
  });

  it("falls back on the family line, never the number line, when the statement line is empty", () => {
    expect(norm(lcl("CARTE", "1234567", "", "JEAN DUPONT"))).toBe("CARTE");
  });
});

describe("normalizeBankLabel — LCL collapsed on one line", () => {
  it("cleans a card payment", () => {
    const out = norm("CARTE 1234567 CB CAFE DU PORT 05/10/26 JEAN DUPONT");
    expect(out).toBe("CB CAFE DU PORT 05/10/26");
    expect(norm("CARTE 1234567 CB SHOP*ONLINE 05/10/26 USD 12,50 EUR 11,52 JEAN DUPONT")).toBe(
      "CB SHOP*ONLINE 05/10/26",
    );
    expect(norm("CARTE X./Y. 1234567 CB SHOP 03/10/26 CREDIT EUR 25,00 Z CREDIT JEAN DUPONT")).toBe(
      "CB SHOP 03/10/26",
    );
  });

  it("cleans a cash withdrawal and a cheque", () => {
    expect(norm("RETRAIT DAB 1234567 CB RETRAIT DU 05/10 VILLE TEST")).toBe("CB RETRAIT DU 05/10");
    expect(norm("CHEQUE N. 1234567")).toBe("CHEQUE 1234567");
  });

  it("cleans transfers", () => {
    expect(norm("VIREMENT VIR SEPA LOYER OCTOBRE R123456789012")).toBe("VIR SEPA LOYER OCTOBRE");
    expect(norm("VIREMENT SEPA RECU VIREMENT ACME PAYROLL R123A12345678")).toBe(
      "VIREMENT ACME PAYROLL",
    );
    expect(norm("VIREMENT INSTANTANE VIR INST JANE DOE R123456789012")).toBe("VIR INST JANE DOE");
  });

  it("cleans a SEPA direct debit and a loan instalment", () => {
    expect(
      norm(
        "AVIS SEPA RECU EM/CR TEST PRLV SEPA ENERGIE TEST ID.FR12ZZZ123456 .MDT.ABC123456 R123456789012",
      ),
    ).toBe("PRLV SEPA ENERGIE TEST");
    expect(norm("PRELEVEMENT DES ECHEANCES ECHEANCE PRET 123456 12345678901234A12")).toBe(
      "ECHEANCE PRET 123456",
    );
  });

  it("drops a family line the statement line repeats", () => {
    expect(norm("COTISATION OFFRE CARTE COTISATION OFFRE CARTE 0001")).toBe(
      "COTISATION OFFRE CARTE 0001",
    );
  });

  it("leaves an unknown shape as it is", () => {
    expect(norm("REMISE  CHEQUES 0001")).toBe("REMISE CHEQUES 0001");
  });
});

describe("normalizeBankLabel — other banks", () => {
  it("only collapses whitespace", () => {
    expect(normalizeBankLabel("CARTE 1234567\nCB  CAFE 05/10/26 ", "Banque Fictive")).toBe(
      "CARTE 1234567 CB CAFE 05/10/26",
    );
  });
});

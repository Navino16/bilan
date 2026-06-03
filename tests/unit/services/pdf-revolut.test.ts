import { describe, it, expect } from "vitest";
import { parseRevolutText } from "@/server/services/imports/pdf/revolut";

// Redacted Revolut layout (real structure, fake data). Two products:
//  Compte courant: opening 100,00 → +30 (bal 130) → −20 (bal 110)
//  Dépôt:          opening 0,00   → +50 (bal 50)
const FIXTURE = `Résumé du solde
Produit Solde d'ouverture Argent sortant Argent entrant Solde de
Compte (Compte courant) 100,00€ 20,00€ 30,00€ 110,00€
Dépôt 0,00€ 0,00€ 50,00€ 50,00€
Total 100,00€ 20,00€ 80,00€ 160,00€
Transactions du compte : du 1 janvier 2025 au 3 juin 2026
Date Description Argent sortant Argent entrant Solde
3 janv. 2025 Paiement reçu de JOHN DOE 30,00€ 130,00€
Référence : test
5 janv. 2025 To Jane Doe 20,00€ 110,00€
Transactions de dépôt de 1 janvier 2025 à 3 juin 2026
Date Description Argent sortant Argent entrant Solde
10 janv. 2025 Versement vers Dépôt 50,00€ 50,00€`;

describe("parseRevolutText", () => {
  it("splits products and signs rows from each product's balance delta", () => {
    const products = parseRevolutText(FIXTURE);
    expect(products.map((p) => p.key)).toEqual(["compte", "depot"]);
    expect(products[0].rows).toEqual([
      { date: new Date("2025-01-03T00:00:00.000Z"), amount: 30, rawLabel: "Paiement reçu de JOHN DOE" },
      { date: new Date("2025-01-05T00:00:00.000Z"), amount: -20, rawLabel: "To Jane Doe" },
    ]);
    expect(products[1].rows).toEqual([
      { date: new Date("2025-01-10T00:00:00.000Z"), amount: 50, rawLabel: "Versement vers Dépôt" },
    ]);
  });

  it("returns no products when there are no transaction sections", () => {
    expect(parseRevolutText("Date Description Argent sortant Argent entrant Solde")).toEqual([]);
  });
});

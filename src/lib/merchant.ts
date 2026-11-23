// Normalizes bank labels so one merchant's rows group together:
// operation prefix, card ref, dates (and what follows) and trailing amounts/refs go.
const PREFIX = /^(PAIEMENT PAR CARTE|CARTE|CB|PRLV SEPA|PRLV|VIR SEPA|VIREMENT|VIR)\s+/i;
const LEADING_REF = /^(X\d{4}\s+)?(\d{2}\/\d{2}(\/\d{2,4})?\s+)?/i;
const DATE_AND_REST = /\s*\b\d{2}\/\d{2}(\/\d{2,4})?\b.*$/;
const TRAILING_REF = /(\s+X?\d[\d.,]*)+$/i;

export function merchantLabel(label: string): string {
  return label
    .replace(/\s+/g, " ")
    .trim()
    .replace(PREFIX, "")
    .replace(LEADING_REF, "")
    .replace(DATE_AND_REST, "")
    .replace(TRAILING_REF, "")
    .trim();
}

export function merchantKey(label: string): string {
  return merchantLabel(label)
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toUpperCase();
}

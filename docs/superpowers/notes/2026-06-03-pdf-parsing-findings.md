# PDF parsing spike — findings (scope 4.3a)

**Date:** 2026-06-03
**Goal:** decide how to parse bank-statement PDFs into `NormalizedRow[]` for the
import pipeline (4.3b), reusing the existing preview → commit flow.

## Library

`pdf-parse@2.4.5` — note this is a **v2 rewrite**: the v1 default-function API
(`import pdf from "pdf-parse"; const d = await pdf(buf)`) is gone. v2 exposes a
`PDFParse` class:

```ts
import { PDFParse } from "pdf-parse";
const parser = new PDFParse({ data: buffer });
const { text, total, pages } = await parser.getText(); // also getTable(), getInfo()
await parser.destroy();
```

Under the hood it uses `pdfjs-dist` (a transitive dep we can import directly for
coordinate-level access — see LCL below).

## Samples analysed

| File | Bank | Pages | Text extraction |
|------|------|-------|-----------------|
| `Revolut.pdf` | Revolut | 17 | Clean, line-oriented ✅ |
| `LCL-commun-avril.pdf` | LCL (compte courant) | 5 | Columns lost in flat text ❌ → needs coordinates |
| `LCL-depot-avril.pdf` | LCL (dépôt) | 4 | same as above |
| `LCL-epargne.pdf` | LCL (épargne) | — | same LCL template |

## Revolut — line-based, sign from balance delta ✅

`getText()` keeps one transaction per leading line, e.g.:

```
3 janv. 2025 Paiement envoyé par SON LAURE-ANNE 50,00€ 441,20€
Référence : cotisation Axel.h
De : SON LAURE-ANNE, BE28732072504420
```

- Columns header: `Date  Description  Argent sortant  Argent entrant  Solde`.
- A row line has the **date**, the **description**, then **two amounts**: the
  movement and the **running balance** (`Solde`, always the last `…€`).
- Sub-lines `Référence : …` and `De :` / `À :` belong to the same transaction
  (extra detail; not separate rows).
- **Sign**: the `sortant`/`entrant` columns are ambiguous in text (only one of
  the two is filled, position lost), BUT the **running balance is present**, so
  `amount = solde[i] − solde[i−1]` gives the signed amount reliably. Verified:
  opening 391,20 → 441,20 = +50 ("Paiement envoyé par …" = received), then
  441,20 → 151,20 = −290 ("To …" = sent). The opening balance is in the
  "Résumé du solde" → "Compte (Compte courant)" / "Dépôt" rows.
- Date format is French abbreviated: `3 janv. 2025` (`janv. févr. mars avr. mai
  juin juil. août sept. oct. nov. déc.`).
- Statement spans the full history (here 17 pages, Jan 2025 → Jun 2026), and has
  two products (Compte courant + Dépôt) — each its own balance thread.

**Approach (Revolut parser):** split into transaction blocks by the leading
`<fr-date> ` pattern; the movement amount + balance are the two trailing `…€`;
sign each by balance delta within the product's thread.

## LCL — columns lost in text, recover via pdfjs coordinates ⚠️

`getText()` (even with `cellSeparator` / `cellThreshold`) and `getTable()` do
**not** preserve the DÉBIT/CRÉDIT columns: amounts come out as a flat block with
no column marker, and labels are emitted in a separate block from the
date+amount rows. So a naive `^date label amount$` regex cannot work, and the
debit-vs-credit sign is **unrecoverable from the flat text**.

Going down to raw pdfjs text items (`page.getTextContent()`, each item has a
`transform` matrix → `x = transform[4]`, `y = transform[5]`) **does** recover
the columns. Page-1 header anchors and amount clusters (x):

```
DATE x≈42   LIBELLE x≈197   VALEUR x≈365   DEBIT x≈433   CREDIT x≈504
debit amounts  → x≈453–458      credit amounts → x≈523–531
ANCIEN SOLDE label x≈286, its amount x≈523
operation dates (e.g. "07.04") → x≈42–43
```

So: **an amount with x < ~490 is a debit (→ negative), x ≥ ~490 is a credit
(→ positive).** Confirmed on the sample: `300,00 @ x=531` is the only credit
(a received transfer); all others at x≈458 are debits.

Row structure to reconstruct (group items by `y` with a small tolerance):
- transaction row = a `dd.mm` operation date in the DATE band (x≈42) on a `y`;
- its **amount** = the `…,dd` item on (near) the same `y`, signed by its x;
- its **label** = the text items in the LIBELLE band (x≈80–360); labels can
  wrap onto sub-lines (`REF.CLIENT:`, `ID.CREANCIER:`, `REF.MANDAT:`,
  `LIBELLE:`) — concatenate the band's lines until the next dated row.
- skip `ANCIEN SOLDE` / `NOUVEAU SOLDE` / header rows.
- the `pdfjs` "standardFontDataUrl" warnings are harmless for text extraction.

**Approach (LCL parser):** coordinate-based. Read the page text items, find the
column x-anchors from the `DATE/LIBELLE/VALEUR/DEBIT/CREDIT` header row (don't
hard-code 490 — derive the debit/credit split from the header anchors so it
survives layout shifts across LCL account types), group items into rows by `y`,
emit one `NormalizedRow` per dated row with the x-signed amount.

## Decision

- **Keep `pdf-parse@2`** for the easy/line-based banks (Revolut) and as the PDF
  loader; **use `pdfjs-dist` directly** (already transitive) for
  coordinate-based banks (LCL).
- **Architecture (confirmed with the user): per-bank parser registry + generic
  fallback.**
  - `detectBank(text)` from a text fingerprint: Revolut → "Revolut Bank UAB" /
    BIC `REVOLT…`; LCL → "Crédit Lyonnais" / "LCL" / BIC `CRLYFRPP`.
  - known bank → its dedicated parser (`parsers[bank]`), reliable sign;
  - unknown → generic best-effort parser feeding the **preview** (user reviews
    & fixes before commit); the UI lists the fully-supported banks.
- **First-class supported banks for 4.3b:** **Revolut** and **LCL** (the user's
  banks; samples in `samples/`).

## Implications for the 4.3b plan (adjust from the original single-parser sketch)

- `parsePdf(buffer)` becomes: load with `PDFParse`, get text, `detectBank`,
  dispatch to a bank parser or the generic fallback → `NormalizedRow[]`.
- The Revolut parser can work off `getText()`. The LCL parser needs the raw
  pdfjs text items (x/y), so `parsePdf` must expose coordinates to it (e.g. a
  small `extractItems(buffer)` helper around `pdfjs-dist`).
- **Unit tests** can't use a flat text fixture for LCL — they need a **committed
  redacted coordinate fixture** (`Array<{ str, x, y }>` captured from a real
  page) so the column logic is tested deterministically with no personal data.
  Revolut can keep a redacted text fixture.
- Sign handling per bank: Revolut = balance delta; LCL = amount x-position vs
  the header's DEBIT/CREDIT anchors; generic = best-effort (treat as needing
  review).

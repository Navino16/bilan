import { PDFParse } from "pdf-parse";
import { getDocument, VerbosityLevel } from "pdfjs-dist/legacy/build/pdf.mjs";

// One positioned text fragment. x = transform[4], y = transform[5] in PDF
// user-space (origin bottom-left).
export type TextItem = { str: string; x: number; y: number; page: number };

// Concatenated text (pdf-parse@2 class API) — for line-based banks + detection.
export async function extractText(buffer: Buffer): Promise<string> {
  const parser = new PDFParse({ data: new Uint8Array(buffer) });
  try {
    return (await parser.getText()).text;
  } finally {
    await parser.destroy();
  }
}

// Positioned items across all pages (pdfjs directly) — for column-based banks.
// verbosity=ERRORS silences harmless "standardFontDataUrl" warnings.
export async function extractItems(buffer: Buffer): Promise<TextItem[]> {
  const doc = await getDocument({
    data: new Uint8Array(buffer),
    verbosity: VerbosityLevel.ERRORS,
  }).promise;
  const items: TextItem[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    for (const raw of content.items) {
      const it = raw as { str: string; transform: number[] };
      const str = it.str.trim();
      if (str)
        items.push({
          str,
          x: Math.round(it.transform[4]),
          y: Math.round(it.transform[5]),
          page: p,
        });
    }
    page.cleanup();
  }
  await doc.destroy();
  return items;
}

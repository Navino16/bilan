import { getDocument, VerbosityLevel } from "pdfjs-dist/legacy/build/pdf.mjs";
import type { PDFDocumentProxy, PDFPageProxy, PageViewport } from "pdfjs-dist/legacy/build/pdf.mjs";

type PdfjsTextItem = Extract<
  Awaited<ReturnType<PDFPageProxy["getTextContent"]>>["items"][number],
  { str: string }
>;

// One positioned text fragment. x = transform[4], y = transform[5] in PDF
// user-space (origin bottom-left).
export type TextItem = { str: string; x: number; y: number; page: number };

async function withDocument<T>(buffer: Buffer, fn: (doc: PDFDocumentProxy) => Promise<T>) {
  // verbosity=ERRORS silences harmless "standardFontDataUrl" warnings.
  const task = getDocument({ data: new Uint8Array(buffer), verbosity: VerbosityLevel.ERRORS });
  try {
    return await fn(await task.promise);
  } finally {
    await task.destroy();
  }
}

async function pageItems(page: PDFPageProxy): Promise<PdfjsTextItem[]> {
  const content = await page.getTextContent();
  return content.items.filter((it): it is PdfjsTextItem => "str" in it);
}

const LINE_THRESHOLD = 4.6;
const CELL_THRESHOLD = 7;

// Reproduces pdf-parse@2 `getText()` defaults, which the line-based bank parsers
// were written against. Not pdf-parse itself: it pins its own pdfjs-dist, and two
// pdfjs copies in one process share a worker and fail on the version mismatch.
export function pageText(
  viewport: Pick<PageViewport, "convertToViewportPoint">,
  items: PdfjsTextItem[],
): string {
  const out: string[] = [];
  let lastX: number | undefined;
  let lastY: number | undefined;
  let lineHeight = 0;
  for (const item of items) {
    let str = item.str;
    const [x, y] = viewport.convertToViewportPoint(item.transform[4], item.transform[5]);
    if (lastY !== undefined && Math.abs(lastY - y) > LINE_THRESHOLD) {
      const startsLine = str.startsWith("\n") || (str.trim() === "" && item.hasEOL);
      if (out.length && !out[out.length - 1].endsWith("\n") && !startsLine) {
        if (Math.abs(lastY - y) - 1 > lineHeight) {
          out.push("\n");
          lineHeight = 0;
        }
      }
    }
    if (lastY !== undefined && Math.abs(lastY - y) < LINE_THRESHOLD) {
      if (lastX !== undefined && Math.abs(lastX - x) > CELL_THRESHOLD) str = `\t${str}`;
    }
    out.push(str);
    lastX = x + item.width;
    lastY = y;
    lineHeight = Math.max(lineHeight, item.height);
    if (item.hasEOL) out.push("\n");
    if (item.hasEOL || str.endsWith("\n")) lineHeight = 0;
  }
  return out.join("");
}

// Concatenated text — for line-based banks + detection.
export async function extractText(buffer: Buffer): Promise<string> {
  return withDocument(buffer, async (doc) => {
    let text = "";
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      text += `${pageText(page.getViewport({ scale: 1 }), await pageItems(page))}\n\n-- ${p} of ${doc.numPages} --\n\n`;
      page.cleanup();
    }
    return text;
  });
}

// Positioned items across all pages — for column-based banks.
export async function extractItems(buffer: Buffer): Promise<TextItem[]> {
  return withDocument(buffer, async (doc) => {
    const items: TextItem[] = [];
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      for (const it of await pageItems(page)) {
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
    return items;
  });
}

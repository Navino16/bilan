import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PDFParse } from "pdf-parse";

// Usage: npx tsx scripts/pdf-spike.ts
// Prints, for each PDF in samples/, the page count and the first ~60 lines of
// extracted text so we can see the statement structure (date/label/amount columns).
//
// NOTE: pdf-parse@2 exposes a `PDFParse` class (the v1 default-function API is
// gone). `new PDFParse({ data: buffer }).getText()` → { text, total, pages }.
async function main() {
  const dir = "samples";
  const files = readdirSync(dir).filter((f) => f.toLowerCase().endsWith(".pdf"));
  if (files.length === 0) {
    console.log("No PDFs in samples/. Drop a bank statement there and re-run.");
    return;
  }
  for (const file of files) {
    const parser = new PDFParse({ data: readFileSync(join(dir, file)) });
    try {
      const result = await parser.getText();
      console.log(`\n===== ${file} — ${result.total} page(s), ${result.text.length} chars =====`);
      console.log(result.text.split("\n").slice(0, 60).join("\n"));
    } finally {
      await parser.destroy();
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

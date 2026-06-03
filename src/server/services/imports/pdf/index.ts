import { extractText, extractItems } from "./extract";
import { detectBank, type BankKey } from "./detect";
import { parseRevolutText } from "./revolut";
import { parseLclItems } from "./lcl";
import { parseGenericText } from "./generic";
import type { ParsedProduct } from "../types";

export { SUPPORTED_BANKS, type BankKey } from "./detect";

// Loads a PDF, detects the bank, dispatches to the matching parser (or the
// generic fallback). Single-product banks (LCL, generic) yield one "default"
// product; Revolut yields one product per statement section.
export async function parsePdf(
  buffer: Buffer,
): Promise<{ bank: BankKey | null; products: ParsedProduct[] }> {
  const text = await extractText(buffer);
  const bank = detectBank(text);
  if (bank === "revolut") return { bank, products: parseRevolutText(text) };
  if (bank === "lcl") {
    return {
      bank,
      products: [{ key: "default", rows: parseLclItems(await extractItems(buffer)) }],
    };
  }
  return { bank: null, products: [{ key: "default", rows: parseGenericText(text) }] };
}

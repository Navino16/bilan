import { createHmac } from "node:crypto";
import { normalizeText, tokenize } from "@/lib/text";

export function hmacForSearch(input: string, key: Buffer): string {
  return createHmac("sha256", key).update(normalizeText(input)).digest("hex");
}

export function hmacTokens(input: string, key: Buffer): string[] {
  return tokenize(input).map((t) => hmacForSearch(t, key));
}

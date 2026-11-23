import { createHmac, type KeyObject } from "node:crypto";
import { normalizeText, searchPrefixes } from "@/lib/text";

export function hmacForSearch(input: string, key: KeyObject | Buffer): string {
  return createHmac("sha256", key).update(normalizeText(input)).digest("hex");
}

// Search-index tokens: one HMAC per word prefix (spec §2.3, #192).
export function hmacTokens(input: string, key: KeyObject | Buffer): string[] {
  return searchPrefixes(input).map((t) => hmacForSearch(t, key));
}

// Exact-match blind index for a secret looked up by its value (signup tokens, invitations).
export function hmacExact(input: string, key: KeyObject | Buffer): string {
  return createHmac("sha256", key).update(input).digest("hex");
}

import { createHash } from "node:crypto";
import { encrypt } from "@/server/crypto/encryption";
import { hmacForSearch, hmacTokens } from "@/server/crypto/hmac";
import { dataKey, searchKey } from "@/server/crypto/keys";

export type SecureFields = {
  labelEnc: string;
  labelHash: string;
  rawLabelEnc: string;
  rawLabelHash: string;
  noteEnc: string | null;
  tokens: string[]; // HMAC of each normalized word ≥ 3 chars (label + rawLabel)
};

// Encrypts the human + raw labels and the optional note, derives equality
// HMAC hashes for both labels, and builds the per-word search-token set used by
// TransactionSearchToken rows. Tokens come from BOTH labels so a search matches
// whichever the user typed.
export function buildSecureFields(input: {
  label: string;
  rawLabel: string;
  note?: string | null;
}): SecureFields {
  const note = input.note?.trim() ? input.note : null;
  const tokens = Array.from(
    new Set([...hmacTokens(input.label, searchKey), ...hmacTokens(input.rawLabel, searchKey)]),
  );
  return {
    labelEnc: encrypt(input.label, dataKey),
    labelHash: hmacForSearch(input.label, searchKey),
    rawLabelEnc: encrypt(input.rawLabel, dataKey),
    rawLabelHash: hmacForSearch(input.rawLabel, searchKey),
    noteEnc: note ? encrypt(note, dataKey) : null,
    tokens,
  };
}

// Stable dedup key for imported rows: sha256 of date(ISO day) + amount + rawLabel.
// Manual entries pass no externalId (no auto-dedup) — this is for CSV/PDF (Phase 4).
export function computeExternalId(date: Date, amount: number, rawLabel: string): string {
  const day = date.toISOString().slice(0, 10);
  return createHash("sha256").update(`${day}|${amount.toFixed(2)}|${rawLabel}`).digest("hex");
}

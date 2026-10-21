import { createHash, randomInt } from "node:crypto";
import { encrypt } from "@/server/crypto/encryption";
import { hmacForSearch, hmacTokens } from "@/server/crypto/hmac";
import { dataKey, searchKey } from "@/server/crypto/keys";
import { merchantKey } from "@/lib/merchant";

export type SecureFields = {
  labelEnc: string;
  labelHash: string;
  rawLabelEnc: string;
  rawLabelHash: string;
  merchantKeyHash: string;
  noteEnc: string | null;
  tokens: string[]; // HMAC of each word prefix ≥ 3 chars (label + rawLabel), see searchPrefixes
};

// Tokens come from BOTH labels so a search matches whichever the user typed. Shuffled so
// token row order doesn't spell out each word's prefix chain (spec §6.2).
export function buildSearchTokens(label: string, rawLabel: string): string[] {
  const tokens = Array.from(
    new Set([...hmacTokens(label, searchKey), ...hmacTokens(rawLabel, searchKey)]),
  );
  for (let i = tokens.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [tokens[i], tokens[j]] = [tokens[j], tokens[i]];
  }
  return tokens;
}

// Prefixed so a one-word merchant's hash can't be matched against transaction search tokens.
export function hashMerchantKey(key: string): string {
  return hmacForSearch(`merchant:${key}`, searchKey);
}

// Encrypts the human + raw labels and the optional note, derives equality
// HMAC hashes for both labels, and builds the search-token set used by
// TransactionSearchToken rows.
export function buildSecureFields(input: {
  label: string;
  rawLabel: string;
  note?: string | null;
}): SecureFields {
  const note = input.note?.trim() ? input.note : null;
  const tokens = buildSearchTokens(input.label, input.rawLabel);
  return {
    labelEnc: encrypt(input.label, dataKey),
    labelHash: hmacForSearch(input.label, searchKey),
    rawLabelEnc: encrypt(input.rawLabel, dataKey),
    rawLabelHash: hmacForSearch(input.rawLabel, searchKey),
    merchantKeyHash: hashMerchantKey(merchantKey(input.label)),
    noteEnc: note ? encrypt(note, dataKey) : null,
    tokens,
  };
}

// Stable dedup key for imported rows: sha256 of date(ISO day) + amount + rawLabel.
// Manual entries pass no externalId (no auto-dedup) — this is for CSV/PDF (Phase 4).
export function computeExternalId(date: Date, amount: number, rawLabel: string): string {
  const day = date.toISOString().slice(0, 10);
  return createHash("sha256")
    .update(`${day}|${amount.toFixed(2)}|${rawLabel}`)
    .digest("hex");
}

// Dedup keys for a batch of imported rows: identical twins in one file (two
// 2,50 € coffees the same day) get an occurrence index, so both are kept while
// re-importing the same file still matches every row.
export function computeExternalIds(
  rows: { date: Date; amount: number; rawLabel: string }[],
): string[] {
  const seen = new Map<string, number>();
  return rows.map((r) => {
    const base = computeExternalId(r.date, r.amount, r.rawLabel);
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    return n === 0 ? base : computeExternalId(r.date, r.amount, `${r.rawLabel}\u0000${n}`);
  });
}

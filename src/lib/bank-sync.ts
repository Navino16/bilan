// Countries Enable Banking covers, offered by the bank picker (client-safe).
export const BANK_COUNTRIES = [
  "AT",
  "BE",
  "DE",
  "DK",
  "EE",
  "ES",
  "FI",
  "FR",
  "GB",
  "IE",
  "IT",
  "LT",
  "LU",
  "LV",
  "NL",
  "NO",
  "PL",
  "PT",
  "SE",
] as const;
export type BankCountry = (typeof BANK_COUNTRIES)[number];

export function isBankCountry(value: unknown): value is BankCountry {
  return typeof value === "string" && (BANK_COUNTRIES as readonly string[]).includes(value);
}

// Background sync intervals offered to the admin, in hours (design §Sync engine).
export const SYNC_INTERVALS = [6, 12, 24] as const;
export type SyncInterval = (typeof SYNC_INTERVALS)[number];

export function isSyncInterval(value: unknown): value is SyncInterval {
  return (SYNC_INTERVALS as readonly unknown[]).includes(value);
}

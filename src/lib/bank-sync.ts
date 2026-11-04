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

// From this many days before the consent ends, the owner is warned (design §Consent lifecycle).
export const CONSENT_WARN_DAYS = 14;
const DAY_MS = 86_400_000;

export type ConsentState = { daysLeft: number; warn: boolean; expired: boolean };

export function consentState(validUntil: Date, now: Date): ConsentState {
  const left = validUntil.getTime() - now.getTime();
  const expired = left <= 0;
  const daysLeft = expired ? 0 : Math.ceil(left / DAY_MS);
  return { daysLeft, warn: !expired && daysLeft <= CONSENT_WARN_DAYS, expired };
}

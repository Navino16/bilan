export const CSV_MAX_BYTES = 5 * 1024 * 1024;
export const PDF_MAX_BYTES = 10 * 1024 * 1024;
export const OFX_MAX_BYTES = 5 * 1024 * 1024;

export const CSV_FIELDS = ["date", "label", "amount", "debit", "credit", "type"] as const;

export const DECIMAL_MARKS = [",", "."] as const;
export type DecimalMark = (typeof DECIMAL_MARKS)[number];

// Day/month order of slashed or dotted dates; ISO dates are never reordered.
export const DATE_ORDERS = ["DMY", "MDY"] as const;
export type DateOrder = (typeof DATE_ORDERS)[number];
export const DEFAULT_DATE_ORDER: DateOrder = "DMY";

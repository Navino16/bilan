const GROUPED: Record<string, RegExp> = {
  ".": /^[-+]?\d{1,3}(\.\d{3})+$/,
  ",": /^[-+]?\d{1,3}(,\d{3})+$/,
};
// "1.234" / "1,234": a thousands group or three decimals, depending on the reader.
const AMBIGUOUS = /^[-+]?[1-9]\d{0,2}[.,]\d{3}$/;
const MAX_ABS = 1e10;

export type AmountError = "AMOUNT_INVALID" | "AMOUNT_AMBIGUOUS" | "AMOUNT_PRECISION";
export const AMOUNT_ERRORS: readonly AmountError[] = [
  "AMOUNT_INVALID",
  "AMOUNT_AMBIGUOUS",
  "AMOUNT_PRECISION",
];

// "1 234,5" → "1234.5". With both separators the last one is the decimal mark.
function normalize(v: string): string | null {
  let s = v.replace(/\s/g, "");
  const comma = s.lastIndexOf(",");
  const dot = s.lastIndexOf(".");
  if (comma >= 0 && dot >= 0) {
    const decimal = Math.max(comma, dot);
    const intPart = s.slice(0, decimal);
    if (!GROUPED[comma > dot ? "." : ","].test(intPart)) return null;
    s = `${intPart.replace(/[.,]/g, "")}.${s.slice(decimal + 1)}`;
  } else {
    s = s.replace(",", ".");
  }
  return /^[-+]?\d+(\.\d+)?$/.test(s) ? s : null;
}

// Parses a user-typed amount: "1 234,5", "-12.50", "1.234,56", "1,234.56" or a
// number. NaN when unparseable.
export function parseAmount(v: string | number): number {
  if (typeof v === "number") return v;
  const s = normalize(v);
  return s === null ? NaN : Number(s);
}

// Strict variant for money inputs: rejects fractions of a cent and ambiguous
// thousands instead of rounding them silently (#161).
export function readAmount(
  v: string | number,
): { ok: true; value: number } | { ok: false; error: AmountError } {
  if (typeof v === "number") {
    if (!Number.isFinite(v) || Math.abs(v) >= MAX_ABS)
      return { ok: false, error: "AMOUNT_INVALID" };
    if (Number(v.toFixed(2)) !== v) return { ok: false, error: "AMOUNT_PRECISION" };
    return { ok: true, value: v };
  }
  if (AMBIGUOUS.test(v.replace(/\s/g, ""))) return { ok: false, error: "AMOUNT_AMBIGUOUS" };
  const s = normalize(v);
  const n = s === null ? NaN : Number(s);
  if (!Number.isFinite(n) || Math.abs(n) >= MAX_ABS) return { ok: false, error: "AMOUNT_INVALID" };
  const fraction = (s!.split(".")[1] ?? "").replace(/0+$/, "");
  if (fraction.length > 2) return { ok: false, error: "AMOUNT_PRECISION" };
  return { ok: true, value: n };
}

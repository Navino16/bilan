// Parses a user-typed amount: "1 234,5", "-12.50" or a number. NaN when unparseable.
export function parseAmount(v: string | number): number {
  if (typeof v === "number") return v;
  const s = v.replace(/\s/g, "").replace(",", ".");
  return /^-?\d+(\.\d+)?$/.test(s) ? Number(s) : NaN;
}

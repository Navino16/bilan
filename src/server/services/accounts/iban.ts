export function normalizeIban(raw: string): string {
  return raw.replace(/\s+/g, "").toUpperCase();
}

// ISO 13616 mod-97 check (value must equal 1). Moves the first 4 chars to the
// end, maps letters A–Z → 10–35, then computes the big-integer mod 97 digit by
// digit to avoid overflow.
export function isValidIban(raw: string): boolean {
  const iban = normalizeIban(raw);
  if (!/^[A-Z0-9]{15,34}$/.test(iban)) return false;
  if (!/^[A-Z]{2}[0-9]{2}/.test(iban)) return false;
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  const digits = rearranged
    .split("")
    .map((c) => (c >= "A" && c <= "Z" ? (c.charCodeAt(0) - 55).toString() : c))
    .join("");
  let remainder = 0;
  for (const d of digits) remainder = (remainder * 10 + Number(d)) % 97;
  return remainder === 1;
}

export function maskIban(raw: string): string {
  const iban = normalizeIban(raw);
  return `•••• ${iban.slice(-4)}`;
}

// Human-readable grouping in blocks of 4, e.g. "FR76 3000 6000 …".
export function formatIban(raw: string): string {
  return normalizeIban(raw)
    .replace(/(.{4})/g, "$1 ")
    .trim();
}

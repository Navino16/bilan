import { createHmac } from "node:crypto";

function normalize(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
}

export function hmacForSearch(input: string, key: Buffer): string {
  return createHmac("sha256", key).update(normalize(input)).digest("hex");
}

export function tokenize(input: string): string[] {
  return Array.from(
    new Set(
      normalize(input)
        .split(/[^a-z0-9]+/)
        .filter((w) => w.length >= 3),
    ),
  );
}

export function hmacTokens(input: string, key: Buffer): string[] {
  return tokenize(input).map((t) => hmacForSearch(t, key));
}

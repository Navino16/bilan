// Search words shorter than this are neither indexed nor searched (blind index, see hmac.ts).
export const MIN_SEARCH_WORD = 3;

// Strips combining accents: "Crème" → "Creme".
export function foldDiacritics(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

// Feeds the search-token HMACs: changing it invalidates every stored token.
export function normalizeText(s: string): string {
  return foldDiacritics(s).toLowerCase().replace(/\s+/g, " ").trim();
}

function words(input: string): string[] {
  return normalizeText(input)
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

export function tokenize(input: string): string[] {
  return Array.from(new Set(words(input).filter((w) => w.length >= MIN_SEARCH_WORD)));
}

// True when a search query contains a word the token index can't match.
export function hasUnsearchableWord(query: string): boolean {
  return words(query).some((w) => w.length < MIN_SEARCH_WORD);
}

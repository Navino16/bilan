// Search words shorter than this are neither indexed nor searched (blind index, see hmac.ts).
export const MIN_SEARCH_WORD = 3;

// Longest indexed prefix: bounds tokens per word (#192). Query words are cut to the same
// length, so a longer query matches every word sharing its first MAX_SEARCH_PREFIX chars.
export const MAX_SEARCH_PREFIX = 12;

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

// Every prefix of MIN_SEARCH_WORD..MAX_SEARCH_PREFIX chars of each word: "lidl" → lid, lidl.
export function searchPrefixes(input: string): string[] {
  const out = new Set<string>();
  for (const w of tokenize(input)) {
    const longest = Math.min(w.length, MAX_SEARCH_PREFIX);
    for (let n = MIN_SEARCH_WORD; n <= longest; n++) out.add(w.slice(0, n));
  }
  return Array.from(out);
}

// Index terms a search query must all match (AND), one per searchable query word.
export function searchQueryTerms(query: string): string[] {
  return Array.from(new Set(tokenize(query).map((w) => w.slice(0, MAX_SEARCH_PREFIX))));
}

// True when a search query contains a word the token index can't match.
export function hasUnsearchableWord(query: string): boolean {
  return words(query).some((w) => w.length < MIN_SEARCH_WORD);
}

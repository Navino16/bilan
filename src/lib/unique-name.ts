export function uniqueName(base: string, taken: Iterable<string | null>): string {
  const names = new Set(Array.from(taken, (n) => n?.trim().toLowerCase()));
  if (!names.has(base.toLowerCase())) return base;
  for (let i = 2; ; i++) {
    const candidate = `${base} (${i})`;
    if (!names.has(candidate.toLowerCase())) return candidate;
  }
}

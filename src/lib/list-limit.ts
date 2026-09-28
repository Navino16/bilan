export const LIST_PAGE_SIZE = 100;
export const LIST_MAX_LIMIT = 1000;

export function parseListLimit(raw: string | undefined): number {
  if (!raw || !/^\d+$/.test(raw)) return LIST_PAGE_SIZE;
  const n = Number(raw);
  if (n < 1) return LIST_PAGE_SIZE;
  return Math.min(n, LIST_MAX_LIMIT);
}

export function nextListLimit(limit: number): number {
  return Math.min(limit + LIST_PAGE_SIZE, LIST_MAX_LIMIT);
}

// A truncated newest-first list may cut its oldest day in half, which would show
// a wrong day subtotal: drop that day unless it's the only one (then flag it).
export function trimToDayBoundary<T extends { date: string }>(
  items: T[],
  truncated: boolean,
): { items: T[]; partialLastDay: boolean } {
  if (!truncated || items.length === 0) return { items, partialLastDay: false };
  const lastDay = items[items.length - 1].date.slice(0, 10);
  const firstOfLastDay = items.findIndex((it) => it.date.slice(0, 10) === lastDay);
  if (firstOfLastDay > 0) return { items: items.slice(0, firstOfLastDay), partialLastDay: false };
  return { items, partialLastDay: true };
}

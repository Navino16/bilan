export const ADMIN_PAGE_SIZE = 50;

export function parsePage(raw: string | undefined): number {
  if (!raw || !/^\d+$/.test(raw)) return 1;
  return Math.max(1, Number(raw));
}

// Clamps `page` into [1, pageCount] so a stale URL lands on the last page instead of an empty one.
export function pageWindow(
  total: number,
  page: number,
  pageSize: number,
): { page: number; pageCount: number; skip: number } {
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const clamped = Math.min(Math.max(1, Math.floor(page)), pageCount);
  return { page: clamped, pageCount, skip: (clamped - 1) * pageSize };
}

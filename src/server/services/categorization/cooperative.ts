export type SliceOptions = {
  sliceSize?: number;
  budgetMs?: number;
  now?: () => number;
  pause?: () => Promise<void>;
};

const nextTurn = () => new Promise<void>((resolve) => setImmediate(resolve));

// Matching is synchronous CPU work: once a slice run exceeds the budget, the event loop gets a
// turn so a large rule batch doesn't stall every other request on the instance (#293).
export async function mapInSlices<T, R>(
  items: T[],
  fn: (slice: T[]) => R,
  {
    sliceSize = 5,
    budgetMs = 20,
    now = () => performance.now(),
    pause = nextTurn,
  }: SliceOptions = {},
): Promise<R[]> {
  const out: R[] = [];
  let start = now();
  for (let i = 0; i < items.length; i += sliceSize) {
    out.push(fn(items.slice(i, i + sliceSize)));
    if (now() - start >= budgetMs) {
      await pause();
      start = now();
    }
  }
  return out;
}

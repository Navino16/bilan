"use client";

import { useState } from "react";

// Returns `live` while closed and its value at opening time while open. Adjusted during
// render, so an `open` driven by a parent (e.g. a row menu) freezes it too.
export function useFrozenWhileOpen<T>(open: boolean, live: T): T {
  const [frozen, setFrozen] = useState<{ value: T } | null>(null);
  if (open && frozen === null) setFrozen({ value: live });
  if (!open && frozen !== null) setFrozen(null);
  return open && frozen ? frozen.value : live;
}

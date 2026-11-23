// A production build gives each route its own copy of a module, so module-level
// caches can't be invalidated across routes; state shared through here is one per process (#208).
const holder = globalThis as unknown as { __bilanProcessState?: Map<string, unknown> };

export function processState<T>(key: string, init: () => T): T {
  const store = (holder.__bilanProcessState ??= new Map());
  if (!store.has(key)) store.set(key, init());
  return store.get(key) as T;
}

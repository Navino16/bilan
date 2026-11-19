import { Prisma } from "@prisma/client";
import { toIsoDay } from "@/lib/period";

const DATE_ONLY_KEYS = new Set(["date", "periodDate", "periodStart", "periodEnd", "from", "to"]);
// Raw bank labels and e-mails never leave through MCP, nor any ciphertext or blind index (spec §5.18).
const isDropped = (key: string) =>
  key === "rawLabel" || key === "email" || key.endsWith("Enc") || key.endsWith("Hash");

export type SerializeOptions = { categoryPaths?: ReadonlyMap<string, string> };

// Turns a service result into plain JSON for a tool response: ISO dates, numbers for
// Decimals, and the category path next to each known `categoryId`.
export function serialize(value: unknown, opts: SerializeOptions = {}, key?: string): unknown {
  if (value instanceof Date) {
    return key && DATE_ONLY_KEYS.has(key) ? toIsoDay(value) : value.toISOString();
  }
  if (Prisma.Decimal.isDecimal(value)) return value.toNumber();
  if (typeof value === "bigint") return Number(value);
  if (Array.isArray(value)) return value.map((v) => serialize(v, opts));
  if (value === null || typeof value !== "object") return value;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    if (v === undefined || isDropped(k)) continue;
    out[k] = serialize(v, opts, k);
    if (k === "categoryId" && typeof v === "string") {
      const path = opts.categoryPaths?.get(v);
      if (path) out.categoryPath = path;
    }
  }
  return out;
}

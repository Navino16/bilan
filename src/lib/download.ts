const PARAM = /;\s*([^\s=;]+)\s*=\s*("(?:[^"\\]|\\.)*"|[^;]*)/g;

function parseParams(header: string): Map<string, string> {
  const params = new Map<string, string>();
  for (const [, name, raw] of header.matchAll(PARAM)) {
    const value = raw.startsWith('"') ? raw.slice(1, -1).replace(/\\(.)/g, "$1") : raw.trim();
    params.set(name.toLowerCase(), value);
  }
  return params;
}

// RFC 5987 ext-value `charset'lang'pct-encoded`; only UTF-8 is decoded, other
// charsets are returned raw rather than mis-decoded.
function decodeExtValue(value: string): string | null {
  const match = value.match(/^([^']*)'[^']*'(.*)$/);
  if (!match) return null;
  if (match[1].toLowerCase() !== "utf-8") return match[2];
  try {
    return decodeURIComponent(match[2]);
  } catch {
    return match[2];
  }
}

// RFC 6266: `filename*` takes precedence over `filename`.
export function filenameFromDisposition(header: string | null, fallback: string): string {
  if (!header) return fallback;
  const params = parseParams(header);
  const extended = params.get("filename*");
  const decoded = extended ? decodeExtValue(extended) : null;
  return decoded || params.get("filename") || fallback;
}

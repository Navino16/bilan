// IPv4 clients reach a dual-stack server as "::ffff:a.b.c.d".
const IPV4_MAPPED = /^(?:::|0:0:0:0:0:)ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i;
const HEX_GROUP = /^[0-9a-f]{1,4}$/i;

// The 8 hextets of a pure-hex IPv6 address, or null.
function hextets(ip: string): number[] | null {
  const halves = ip.split("::");
  if (halves.length > 2) return null;
  const split = (s: string) => (s ? s.split(":") : []);
  const head = split(halves[0]);
  const tail = halves.length === 2 ? split(halves[1]) : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 2 ? missing < 1 : missing !== 0) return null;
  const groups = [...head, ...Array<string>(missing).fill("0"), ...tail];
  return groups.every((g) => HEX_GROUP.test(g)) ? groups.map((g) => parseInt(g, 16)) : null;
}

// RFC 5952 §4: lowercase, no leading zeros, the longest run (≥ 2) of zero groups as "::".
function compressIpv6(groups: number[]): string {
  let best = { start: -1, len: 0 };
  for (let i = 0; i < 8; ) {
    if (groups[i] !== 0) {
      i++;
      continue;
    }
    let j = i;
    while (j < 8 && groups[j] === 0) j++;
    if (j - i > best.len) best = { start: i, len: j - i };
    i = j;
  }
  const hex = groups.map((g) => g.toString(16));
  if (best.len < 2) return hex.join(":");
  const head = hex.slice(0, best.start).join(":");
  const tail = hex.slice(best.start + best.len).join(":");
  return `${head}::${tail}`;
}

// Canonical display form: IPv4-mapped unwrapped, IPv6 compressed; anything else as is.
export function normalizeIp(ip: string | null): string | null {
  if (!ip) return null;
  const v4 = IPV4_MAPPED.exec(ip)?.[1];
  if (v4) return v4;
  const groups = ip.includes(":") ? hextets(ip) : null;
  if (!groups) return ip;
  if (groups.slice(0, 5).every((g) => g === 0) && groups[5] === 0xffff) {
    return [groups[6] >> 8, groups[6] & 0xff, groups[7] >> 8, groups[7] & 0xff].join(".");
  }
  return compressIpv6(groups);
}

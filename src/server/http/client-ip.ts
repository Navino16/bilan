import { isIP } from "node:net";
import { env } from "@/env";
import { normalizeIp } from "@/lib/ip";

// Set by the app itself (proxy.ts, the /api/auth route) and the only header Better Auth reads.
export const CLIENT_IP_HEADER = "x-bilan-client-ip";

export function resolveClientIp(
  headers: Headers | undefined,
  trusted: string = env.TRUSTED_IP_HEADER,
): string | null {
  const raw = headers?.get(trusted);
  if (!raw) return null;
  const hops = raw
    .split(",")
    .map((h) => h.trim())
    .filter(Boolean);
  // The reverse proxy appends the peer it saw; every earlier X-Forwarded-For hop is client-supplied.
  const hop = trusted.toLowerCase() === "x-forwarded-for" ? hops.at(-1) : hops[0];
  return hop ? parseHop(hop) : null;
}

export function requestOrigin(headers: Headers | undefined): {
  ip: string | null;
  userAgent: string | null;
} {
  return { ip: resolveClientIp(headers), userAgent: headers?.get("user-agent") ?? null };
}

// Accepts "a.b.c.d", "a.b.c.d:port", "v6", "[v6]" and "[v6]:port"; anything else is null.
function parseHop(hop: string): string | null {
  const bracketed = /^\[([^\]]+)\](?::\d+)?$/.exec(hop);
  const v4WithPort = /^(\d{1,3}(?:\.\d{1,3}){3}):\d+$/.exec(hop);
  const ip = normalizeIp(bracketed?.[1] ?? v4WithPort?.[1] ?? hop);
  return ip && isIP(ip) ? ip : null;
}

/** Copy of `headers` whose CLIENT_IP_HEADER holds the resolved IP; a client-sent value never survives. */
export function withClientIp(headers: Headers): Headers {
  const out = new Headers(headers);
  const ip = resolveClientIp(headers);
  if (ip) out.set(CLIENT_IP_HEADER, ip);
  else out.delete(CLIENT_IP_HEADER);
  return out;
}

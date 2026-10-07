// IPv4 clients reach a dual-stack server as "::ffff:a.b.c.d".
const IPV4_MAPPED = /^(?:::|0:0:0:0:0:)ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i;

export function normalizeIp(ip: string | null): string | null {
  if (!ip) return null;
  return IPV4_MAPPED.exec(ip)?.[1] ?? ip;
}

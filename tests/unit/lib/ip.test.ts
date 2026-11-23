import { describe, it, expect } from "vitest";
import { normalizeIp } from "@/lib/ip";

describe("normalizeIp", () => {
  it.each([
    ["::ffff:10.0.1.1", "10.0.1.1"],
    ["::FFFF:192.168.1.2", "192.168.1.2"],
    ["0:0:0:0:0:ffff:10.0.1.1", "10.0.1.1"],
    ["::ffff:0a00:0101", "10.0.1.1"],
  ])("unwraps the IPv4-mapped %s", (ip, expected) => {
    expect(normalizeIp(ip)).toBe(expected);
  });

  // Better Auth stores IPv6 expanded (`2001:0db8:0000:…`); sessions and e-mails show RFC 5952 (#226).
  it.each([
    ["0000:0000:0000:0000:0000:0000:0000:0001", "::1"],
    ["0000:0000:0000:0000:0000:0000:0000:0000", "::"],
    ["2001:0db8:0000:0000:0000:0000:0000:0000", "2001:db8::"],
    ["2001:0DB8:0000:0000:0001:0000:0000:0001", "2001:db8::1:0:0:1"],
    ["2001:db8:0:1:1:1:1:1", "2001:db8:0:1:1:1:1:1"],
    ["2001:0:0:1:0:0:0:1", "2001:0:0:1::1"],
    ["fe80:0000:0000:0000:0204:61ff:fe9d:f156", "fe80::204:61ff:fe9d:f156"],
  ])("compresses the IPv6 %s", (ip, expected) => {
    expect(normalizeIp(ip)).toBe(expected);
  });

  it.each(["2001:db8::1", "10.0.1.1", "::1", "::ffff:", "1:2:3", "fe80::1%eth0", "not-an-ip"])(
    "keeps %s as is",
    (ip) => {
      expect(normalizeIp(ip)).toBe(ip);
    },
  );

  it("returns null for a missing address", () => {
    expect(normalizeIp(null)).toBeNull();
    expect(normalizeIp("")).toBeNull();
  });
});

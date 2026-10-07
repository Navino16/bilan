import { describe, it, expect } from "vitest";
import { normalizeIp } from "@/lib/ip";

describe("normalizeIp", () => {
  it.each([
    ["::ffff:10.0.1.1", "10.0.1.1"],
    ["::FFFF:192.168.1.2", "192.168.1.2"],
    ["0:0:0:0:0:ffff:10.0.1.1", "10.0.1.1"],
  ])("unwraps the IPv4-mapped %s", (ip, expected) => {
    expect(normalizeIp(ip)).toBe(expected);
  });

  it.each(["::ffff:0a00:0101", "::ffff:", "2001:db8::1", "10.0.1.1", "::1"])(
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

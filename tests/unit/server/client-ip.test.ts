import { describe, it, expect } from "vitest";
import { CLIENT_IP_HEADER, resolveClientIp, withClientIp } from "@/server/http/client-ip";

const h = (init: Record<string, string>) => new Headers(init);

describe("resolveClientIp", () => {
  it("takes the last X-Forwarded-For hop, the one the reverse proxy appended", () => {
    const headers = h({ "x-forwarded-for": "6.6.6.6, 10.0.0.9,203.0.113.7" });
    expect(resolveClientIp(headers, "x-forwarded-for")).toBe("203.0.113.7");
  });

  it("reads a single-value header as is", () => {
    const headers = h({ "x-forwarded-for": "6.6.6.6", "x-real-ip": "203.0.113.8" });
    expect(resolveClientIp(headers, "x-real-ip")).toBe("203.0.113.8");
  });

  it("unwraps IPv4-mapped addresses and ignores empty hops", () => {
    expect(
      resolveClientIp(h({ "x-forwarded-for": "1.1.1.1, ::ffff:10.0.0.1, " }), "x-forwarded-for"),
    ).toBe("10.0.0.1");
  });

  it.each([
    ["1.2.3.4:5678", "1.2.3.4"],
    ["[2001:db8::1]", "2001:db8::1"],
    ["[2001:db8::1]:443", "2001:db8::1"],
    ["2001:db8::1", "2001:db8::1"],
    ["unknown", null],
    ["", null],
    ["1.2.3.4:", null],
    ["999.1.1.1", null],
  ])("parses the hop %j as %j", (hop, expected) => {
    expect(resolveClientIp(h({ "x-real-ip": hop }), "x-real-ip")).toBe(expected);
  });

  it("returns null without the trusted header", () => {
    expect(resolveClientIp(h({ "x-real-ip": "1.2.3.4" }), "x-forwarded-for")).toBeNull();
    expect(resolveClientIp(undefined)).toBeNull();
  });

  it("defaults to X-Forwarded-For", () => {
    expect(resolveClientIp(h({ "x-forwarded-for": "6.6.6.6, 203.0.113.9" }))).toBe("203.0.113.9");
  });
});

describe("withClientIp", () => {
  it("overwrites a client-sent canonical header with the resolved IP", () => {
    const out = withClientIp(
      h({ [CLIENT_IP_HEADER]: "6.6.6.6", "x-forwarded-for": "6.6.6.6, 203.0.113.10" }),
    );
    expect(out.get(CLIENT_IP_HEADER)).toBe("203.0.113.10");
  });

  it("drops a client-sent canonical header when no IP resolves", () => {
    expect(withClientIp(h({ [CLIENT_IP_HEADER]: "6.6.6.6" })).has(CLIENT_IP_HEADER)).toBe(false);
  });
});

import { describe, it, expect } from "vitest";
import { describeUserAgent } from "@/lib/user-agent";

const UA = {
  chromeWindows:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.7778.96 Safari/537.36",
  edgeWindows:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36 Edg/148.0.0.0",
  firefoxLinux: "Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0",
  safariIphone:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1",
  chromeIphone:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/148.0.0.0 Mobile/15E148 Safari/604.1",
  safariMac:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Safari/605.1.15",
  chromeAndroid:
    "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Mobile Safari/537.36",
  firefoxAndroid: "Mozilla/5.0 (Android 15; Mobile; rv:140.0) Gecko/140.0 Firefox/140.0",
  headlessChrome:
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/148.0.7778.96 Safari/537.36",
};

describe("describeUserAgent", () => {
  it.each([
    ["chromeWindows", "Chrome", "Windows", false],
    ["edgeWindows", "Edge", "Windows", false],
    ["firefoxLinux", "Firefox", "Linux", false],
    ["safariIphone", "Safari", "iPhone", true],
    ["chromeIphone", "Chrome", "iPhone", true],
    ["safariMac", "Safari", "macOS", false],
    ["chromeAndroid", "Chrome", "Android", true],
    ["firefoxAndroid", "Firefox", "Android", true],
    ["headlessChrome", "Chrome", "Linux", false],
  ] as const)("%s → %s on %s", (key, browser, os, mobile) => {
    expect(describeUserAgent(UA[key])).toEqual({ browser, os, mobile });
  });

  it("returns nulls for a missing or unknown user agent", () => {
    expect(describeUserAgent(null)).toEqual({ browser: null, os: null, mobile: false });
    expect(describeUserAgent("curl/8.5.0")).toEqual({ browser: null, os: null, mobile: false });
  });
});

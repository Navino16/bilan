import { describe, expect, it } from "vitest";
import {
  formatBytes,
  formatCount,
  formatDate,
  formatDateRange,
  formatDateTime,
  formatDayMonth,
  formatPercent,
} from "@/lib/format";

// Intl emits U+00A0 / U+2009 / U+202F; compare with plain spaces.
const plain = (s: string) => s.replace(/[\u00a0\u2009\u202f]/g, " ");

const oct1 = new Date(Date.UTC(2026, 9, 1));

describe("formatDate", () => {
  it("uses the medium style, in UTC", () => {
    expect(formatDate(oct1, "fr")).toBe("1 oct. 2026");
    expect(formatDate(oct1, "en")).toBe("Oct 1, 2026");
    expect(formatDate("2026-10-01T23:59:59.999Z", "en")).toBe("Oct 1, 2026");
  });
});

describe("formatDateTime", () => {
  it("appends a short time", () => {
    const at = new Date(Date.UTC(2026, 9, 1, 16, 3, 9));
    expect(formatDateTime(at, "fr", { timeZone: "UTC" })).toBe("1 oct. 2026, 16:03");
    expect(plain(formatDateTime(at, "en", { timeZone: "UTC" }))).toBe("Oct 1, 2026, 4:03 PM");
  });

  it("can show seconds", () => {
    const at = new Date(Date.UTC(2026, 9, 1, 16, 3, 9));
    expect(formatDateTime(at, "fr", { timeZone: "UTC", seconds: true })).toBe(
      "1 oct. 2026, 16:03:09",
    );
    expect(plain(formatDateTime(at, "en", { timeZone: "UTC", seconds: true }))).toBe(
      "Oct 1, 2026, 4:03:09 PM",
    );
  });

  it("reuses formatters without mixing their options", () => {
    const at = new Date(Date.UTC(2026, 9, 1, 16, 3, 9));
    expect(formatDateTime(at, "fr", { timeZone: "UTC" })).toBe("1 oct. 2026, 16:03");
    expect(formatDateTime(at, "fr", { timeZone: "Europe/Paris" })).toBe("1 oct. 2026, 18:03");
  });
});

describe("formatDateRange", () => {
  it("collapses the shared parts", () => {
    const to = new Date(Date.UTC(2026, 9, 6));
    expect(plain(formatDateRange(oct1, to, "fr"))).toBe("1–6 oct. 2026");
    expect(plain(formatDateRange(oct1, to, "en"))).toBe("Oct 1 – 6, 2026");
  });
});

describe("formatDayMonth", () => {
  it("drops the year", () => {
    expect(formatDayMonth(oct1, "fr")).toBe("1 oct.");
    expect(formatDayMonth(oct1, "en")).toBe("Oct 1");
  });
});

describe("formatPercent", () => {
  it("follows the locale's spacing", () => {
    expect(plain(formatPercent(0.39, "fr"))).toBe("39 %");
    expect(formatPercent(0.39, "en")).toBe("39%");
  });

  it("can show the sign", () => {
    expect(formatPercent(0.04, "en", { signed: true })).toBe("+4%");
    expect(formatPercent(-0.04, "en", { signed: true })).toBe("-4%");
    expect(formatPercent(0, "en", { signed: true })).toBe("0%");
  });
});

describe("formatCount", () => {
  it("groups thousands", () => {
    expect(plain(formatCount(4862, "fr"))).toBe("4 862");
    expect(formatCount(4862, "en")).toBe("4,862");
  });
});

describe("formatBytes", () => {
  it("uses localized units", () => {
    expect(plain(formatBytes(512, "fr"))).toBe("512 o");
    expect(plain(formatBytes(1536, "fr"))).toBe("1,5 Ko");
    expect(plain(formatBytes(5 * 1024 ** 2, "fr"))).toBe("5 Mo");
    expect(plain(formatBytes(512, "en"))).toBe("512 B");
    expect(plain(formatBytes(1536, "en"))).toBe("1.5 KB");
    expect(plain(formatBytes(20 * 1024 ** 2, "en"))).toBe("20 MB");
  });
});

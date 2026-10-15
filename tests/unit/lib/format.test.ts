import { describe, expect, it } from "vitest";
import {
  formatAmountInput,
  formatBytes,
  formatCount,
  formatDate,
  formatDateRange,
  formatDateTime,
  formatDayMonth,
  formatLongDay,
  formatMoney,
  formatMonthRange,
  ordinalSegments,
  formatMonthYear,
  formatPercent,
} from "@/lib/format";
import { readAmount } from "@/lib/amount";

// Number formats keep Intl's U+00A0 / U+202F; compare them with plain spaces.
const plain = (s: string) => s.replace(/[\u00a0\u2009\u202f]/g, " ");

const NBSP = String.fromCharCode(0xa0);
const NNBSP = String.fromCharCode(0x202f);

const oct1 = new Date(Date.UTC(2026, 9, 1));
const oct11 = new Date(Date.UTC(2026, 9, 11));

describe("formatDate", () => {
  it("uses the medium style, in UTC", () => {
    expect(formatDate(oct11, "fr")).toBe("11 oct. 2026");
    expect(formatDate(oct1, "en")).toBe("Oct 1, 2026");
    expect(formatDate("2026-10-01T23:59:59.999Z", "en")).toBe("Oct 1, 2026");
  });

  it("writes the first of the month as « 1er » in French only (#226)", () => {
    expect(formatDate(oct1, "fr")).toBe("1er oct. 2026");
    expect(formatDate(new Date(Date.UTC(2026, 9, 21)), "fr")).toBe("21 oct. 2026");
    expect(formatDate(new Date(Date.UTC(2026, 9, 31)), "fr")).toBe("31 oct. 2026");
  });
});

describe("formatDateTime", () => {
  it("appends a short time", () => {
    const at = new Date(Date.UTC(2026, 9, 1, 16, 3, 9));
    expect(formatDateTime(at, "fr", { timeZone: "UTC" })).toBe("1er oct. 2026, 16:03");
    expect(formatDateTime(at, "en", { timeZone: "UTC" })).toBe("Oct 1, 2026, 4:03 PM");
  });

  it("can show seconds", () => {
    const at = new Date(Date.UTC(2026, 9, 1, 16, 3, 9));
    expect(formatDateTime(at, "fr", { timeZone: "UTC", seconds: true })).toBe(
      "1er oct. 2026, 16:03:09",
    );
    expect(formatDateTime(at, "en", { timeZone: "UTC", seconds: true })).toBe(
      "Oct 1, 2026, 4:03:09 PM",
    );
  });

  it("reuses formatters without mixing their options", () => {
    const at = new Date(Date.UTC(2026, 9, 1, 16, 3, 9));
    expect(formatDateTime(at, "fr", { timeZone: "UTC" })).toBe("1er oct. 2026, 16:03");
    expect(formatDateTime(at, "fr", { timeZone: "Europe/Paris" })).toBe("1er oct. 2026, 18:03");
  });
});

describe("formatDateRange", () => {
  // Node's ICU puts U+2009 around the dash, Chromium plain spaces: React #418 on /en/budgets.
  it("uses plain spaces so SSR and the browser agree (#226)", () => {
    const to = new Date(Date.UTC(2026, 9, 31));
    expect(formatDateRange(oct1, to, "en")).toBe("Oct 1 – 31, 2026");
    expect(formatDateRange(oct1, to, "fr")).toBe("1er–31 oct. 2026");
    expect(formatDateRange(new Date(Date.UTC(2026, 8, 1)), to, "fr")).toBe(
      "1er sept. – 31 oct. 2026",
    );
  });

  it("collapses the shared parts", () => {
    const to = new Date(Date.UTC(2026, 9, 16));
    expect(formatDateRange(oct11, to, "fr")).toBe("11–16 oct. 2026");
    expect(formatDateRange(oct11, to, "en")).toBe("Oct 11 – 16, 2026");
  });
});

describe("formatMonthRange / formatMonthYear", () => {
  it("formats whole months", () => {
    const apr = new Date(Date.UTC(2026, 3, 1));
    const jun = new Date(Date.UTC(2026, 5, 30));
    expect(formatMonthRange(apr, jun, "fr")).toBe("avr.–juin 2026");
    expect(formatMonthRange(apr, jun, "en")).toBe("Apr – Jun 2026");
    expect(formatMonthYear(oct1, "fr")).toBe("octobre 2026");
    expect(formatMonthYear(oct1, "en", { month: "short" })).toBe("Oct 2026");
  });
});

describe("formatDayMonth", () => {
  it("drops the year", () => {
    expect(formatDayMonth(oct1, "fr")).toBe("1er oct.");
    expect(formatDayMonth(oct11, "fr")).toBe("11 oct.");
    expect(formatDayMonth(oct1, "en")).toBe("Oct 1");
  });
});

describe("formatLongDay", () => {
  it("spells the day out, the year optional", () => {
    expect(formatLongDay("2026-10-01", "fr")).toBe("jeudi 1er octobre 2026");
    expect(formatLongDay("2026-10-01", "fr", { year: false })).toBe("jeudi 1er octobre");
    expect(formatLongDay("2026-10-01", "en")).toBe("Thursday, October 1, 2026");
  });
});

describe("ordinalSegments", () => {
  it("isolates the French ordinal suffix so CSS uppercase can spare it (#245)", () => {
    expect(ordinalSegments("jeudi 1er octobre")).toEqual(["jeudi 1", "er", " octobre"]);
    expect(ordinalSegments("1er–31 oct. 2026")).toEqual(["1", "er", "–31 oct. 2026"]);
    expect(ordinalSegments("1er sept. – 1er oct.")).toEqual([
      "1",
      "er",
      " sept. – 1",
      "er",
      " oct.",
    ]);
    expect(ordinalSegments("11 oct. 2026")).toEqual(["11 oct. 2026"]);
    expect(ordinalSegments("Thursday, October 1, 2026")).toEqual(["Thursday, October 1, 2026"]);
  });
});

describe("formatMoney", () => {
  it("always shows cents (#226)", () => {
    expect(formatMoney(2.9, "fr")).toBe(`2,90${NBSP}€`);
    expect(formatMoney(1234.5, "fr")).toBe(`1${NNBSP}234,50${NBSP}€`);
    expect(formatMoney(25, "en")).toBe("€25.00");
  });
});

describe("formatAmountInput", () => {
  it("writes the amount the way the locale does, readable back by readAmount", () => {
    expect(formatAmountInput(1234.5, "fr")).toBe(`1${NNBSP}234,50`);
    expect(formatAmountInput(100.5, "fr")).toBe("100,50");
    expect(formatAmountInput(-8.5, "fr")).toBe("-8,50");
    expect(formatAmountInput(-0, "fr")).toBe("0,00");
    expect(formatAmountInput(1234.5, "en")).toBe("1,234.50");
    for (const locale of ["fr", "en"]) {
      for (const n of [0, 0.5, -8.5, 1234.5, -1234567.89]) {
        expect(readAmount(formatAmountInput(n, locale))).toEqual({ ok: true, value: n });
      }
    }
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

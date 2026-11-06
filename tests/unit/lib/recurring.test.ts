import { describe, it, expect } from "vitest";
import { median, recurringIds, recurringPayments } from "@/lib/recurring";
import type { MerchantRow } from "@/lib/insights";

const at = (month: number, day: number) => new Date(Date.UTC(2026, month - 1, day));
const row = (
  label: string,
  amount: number,
  date: Date,
  categoryId: string | null = "subs",
  type = "CARD",
): MerchantRow => ({ label, amount: -amount, date, categoryId, type });
// One payment per month, `months` being 1-based months of 2026.
const monthly = (label: string, amounts: number[], months: number[], day = 8) =>
  months.map((m, i) => row(label, amounts[i] ?? amounts[amounts.length - 1], at(m, day)));

const asOf = new Date("2026-10-20T00:00:00.000Z");
const dataStart = at(1, 1);
const detect = (rows: MerchantRow[], aliases?: Map<string, string>) =>
  recurringPayments(rows, asOf, dataStart, aliases);

describe("median", () => {
  it("takes the middle value, or the mean of the two middle ones", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });
});

describe("recurringPayments", () => {
  it("finds a merchant paid about every month, with its usual amount and last date", () => {
    const { payments, monthly: total } = detect(
      monthly("CB NETFLIX.COM", [13.49], [5, 6, 7, 8, 9, 10]),
    );
    expect(payments).toEqual([
      {
        id: `k:NETFLIX.COM:${at(5, 8).toISOString()}`,
        label: "NETFLIX.COM",
        search: "NETFLIX.COM",
        categoryId: "subs",
        usual: 13.49,
        last: 13.49,
        lastDate: at(10, 8),
        count: 6,
        flags: [],
      },
    ]);
    expect(total).toBe(13.49);
  });

  it("needs three payments in the last six months", () => {
    expect(detect(monthly("CB SPOTIFY", [11.12], [9, 10])).payments).toEqual([]);
    // March is out of the window (May to October).
    expect(detect(monthly("CB SPOTIFY", [11.12], [3, 4, 5])).payments).toHaveLength(0);
  });

  it("needs roughly monthly intervals", () => {
    const weekly = [1, 8, 15, 22, 29].map((d) => row("CB GYM", 10, at(9, d)));
    expect(detect(weekly).payments).toEqual([]);
    const sixWeekly = [at(5, 1), at(6, 15), at(7, 30), at(9, 13)].map((d) =>
      row("PRLV URSSAF", 300, d),
    );
    expect(detect(sixWeekly).payments).toEqual([]);
  });

  it("keeps a series going over one skipped month", () => {
    const rows = monthly("CB NAVIGO MOIS", [86.4], [6, 7, 9, 10], 1);
    expect(detect(rows).payments[0]).toMatchObject({ count: 4, flags: [] });
  });

  it("tolerates a few days of drift between payments", () => {
    const rows = [at(6, 28), at(8, 2), at(8, 29), at(10, 3)].map((d) => row("PRLV EDF", 60, d));
    expect(detect(rows).payments).toHaveLength(1);
  });

  it("keeps amounts within the tolerance of the median together", () => {
    const rows = monthly("PRLV EDF", [60, 52, 70, 64], [7, 8, 9, 10]);
    expect(detect(rows).payments[0]).toMatchObject({ usual: 62, count: 4 });
    // 20 € is far below a 60 € median: it stays out of the series.
    const off = monthly("PRLV EDF", [60, 60, 20, 60, 60], [6, 7, 8, 9, 10]);
    expect(detect(off).payments[0]).toMatchObject({ usual: 60, count: 4 });
  });

  it("splits one merchant's payments into several series by amount", () => {
    const loan = monthly("PRLV CREDIT AGRICOLE", [800], [7, 8, 9, 10], 5);
    const insurance = monthly("PRLV CREDIT AGRICOLE", [30], [7, 8, 9, 10], 5);
    const { payments, monthly: total } = detect([...loan, ...insurance]);
    expect(payments.map((p) => p.usual)).toEqual([800, 30]);
    expect(total).toBe(830);
  });

  it("leaves out shops paid several times a month", () => {
    const rows = [5, 6, 7, 8, 9, 10].flatMap((m) =>
      [3, 10, 17, 24].map((d) => row("CB LIDL", 50, at(m, d))),
    );
    expect(detect(rows).payments).toEqual([]);
  });

  it("leaves out a merchant whose series hold under 80 % of its payments", () => {
    const series = monthly("CB CAFE", [5], [5, 6, 7, 8, 9, 10]);
    const others = [12, 30, 4, 22, 45, 9].map((a, i) => row("CB CAFE", a, at(i + 5, 20)));
    expect(detect([...series, ...others]).payments).toEqual([]);
    expect(detect([...series, ...others.slice(0, 1)]).payments).toHaveLength(1);
  });

  it("ignores income and transfers", () => {
    const pay = [7, 8, 9, 10].map((m) => ({ ...row("VIR SALAIRE", 0, at(m, 28)), amount: 2000 }));
    const rent = [7, 8, 9, 10].map((m) => row("VIR LOYER", 900, at(m, 2), "rent", "TRANSFER"));
    expect(detect([...pay, ...rent]).payments).toEqual([]);
  });

  it("flags a last payment above the usual amount by more than 5 % or 1 €", () => {
    const up = monthly("CB NETFLIX.COM", [13.49, 13.49, 13.49, 15.99], [7, 8, 9, 10]);
    const { payments, monthly: total, extra } = detect(up);
    expect(payments[0]).toMatchObject({ usual: 13.49, last: 15.99, flags: ["increase"] });
    expect(total).toBe(15.99);
    expect(extra).toBe(2.5);
    // +0.90 € on 13.49 €: under both thresholds.
    const small = monthly("CB NETFLIX.COM", [13.49, 13.49, 13.49, 14.39], [7, 8, 9, 10]);
    expect(detect(small).payments[0].flags).toEqual([]);
    // +4 € on 100 €: over 1 € but under 5 %.
    const share = monthly("PRLV MUTUELLE", [100, 100, 100, 104], [7, 8, 9, 10]);
    expect(detect(share).payments[0].flags).toEqual([]);
  });

  it("flags a series that started in the last two months as new", () => {
    const { payments, extra } = detect(monthly("CB DISNEY PLUS", [8.99], [8, 9, 10]));
    expect(payments[0].flags).toEqual(["new"]);
    expect(extra).toBe(8.99);
    expect(detect(monthly("CB DISNEY PLUS", [8.99], [7, 8, 9, 10])).payments[0].flags).toEqual([]);
  });

  it("is not new when the merchant was paid before, or nothing was recorded before", () => {
    const before = [
      ...monthly("CB DISNEY PLUS", [30], [5, 6, 7]),
      ...monthly("CB DISNEY PLUS", [8.99], [8, 9, 10]),
    ];
    expect(detect(before).payments.map((p) => [p.usual, p.flags])).toEqual([
      [8.99, []],
      [30, ["stopped"]],
    ]);
    const fresh = recurringPayments(monthly("CB DISNEY PLUS", [8.99], [8, 9, 10]), asOf, at(8, 1));
    expect(fresh.payments[0].flags).toEqual([]);
  });

  it("flags a series that missed its usual month as stopped, and leaves it out of the total", () => {
    const { payments, monthly: total } = detect([
      ...monthly("PRLV BASIC FIT", [29.99], [5, 6, 7, 8], 5),
      ...monthly("CB SPOTIFY", [11.12], [7, 8, 9, 10], 1),
    ]);
    expect(payments.map((p) => [p.label, p.flags])).toEqual([
      ["SPOTIFY", []],
      ["BASIC FIT", ["stopped"]],
    ]);
    expect(total).toBe(11.12);
  });

  it("lists increases and new ones first, then by amount, stopped ones last", () => {
    const { payments } = detect([
      ...monthly("PRLV FONCIA LOYER", [890], [5, 6, 7, 8, 9, 10], 2),
      ...monthly("PRLV BASIC FIT", [29.99], [5, 6, 7, 8], 5),
      ...monthly("CB SPOTIFY", [11.12], [5, 6, 7, 8, 9, 10], 1),
      ...monthly("CB NETFLIX.COM", [13.49, 13.49, 13.49, 15.99], [7, 8, 9, 10]),
      ...monthly("CB DISNEY PLUS", [8.99], [8, 9, 10]),
    ]);
    expect(payments.map((p) => p.label)).toEqual([
      "NETFLIX.COM",
      "DISNEY PLUS",
      "FONCIA LOYER",
      "SPOTIFY",
      "BASIC FIT",
    ]);
  });

  it("groups the merchants sharing an alias, and shows the alias", () => {
    const rows = [
      row("PRLV FREE MOBILE", 15.99, at(8, 18)),
      row("PRLV FREE TELECOM", 15.99, at(9, 18)),
      row("PRLV FREE MOBILE", 15.99, at(10, 18)),
    ];
    expect(detect(rows).payments).toEqual([]);
    const aliases = new Map([
      ["FREE MOBILE", "Free"],
      ["FREE TELECOM", "Free"],
    ]);
    expect(detect(rows, aliases).payments[0]).toMatchObject({
      label: "Free",
      search: "FREE MOBILE",
      count: 3,
    });
  });

  it("only looks at payments up to the reference date", () => {
    const rows = monthly("CB SPOTIFY", [11.12], [8, 9, 10, 11]);
    const { payments } = recurringPayments(rows, at(9, 30), dataStart);
    expect(payments).toEqual([]);
  });
});

describe("recurringIds", () => {
  it("returns the rows of the recurring series only", () => {
    const withId = (r: MerchantRow, id: string): MerchantRow => ({ ...r, id });
    const series = monthly("PRLV EDF", [60, 60, 60, 60, 20], [6, 7, 8, 9, 10]).map((r, i) =>
      withId(r, `edf-${i}`),
    );
    const oneOff = withId(row("CB NORAUTO", 244, at(10, 12)), "norauto");
    expect(recurringIds([...series, oneOff], asOf)).toEqual(
      new Set(["edf-0", "edf-1", "edf-2", "edf-3"]),
    );
  });
});

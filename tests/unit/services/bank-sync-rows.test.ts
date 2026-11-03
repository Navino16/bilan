import { describe, expect, it } from "vitest";
import { pickBalances, syncWindowStart, toSyncRows } from "@/server/services/bank-sync/rows";
import type { EbBalance, EbTransaction } from "@/server/services/bank-sync/types";

const tx = (o: Partial<EbTransaction> & Pick<EbTransaction, "credit_debit_indicator">) =>
  ({
    transaction_amount: { amount: "0.00", currency: "EUR" },
    status: "BOOK",
    ...o,
  }) as EbTransaction;

const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

describe("toSyncRows", () => {
  it("maps a booked debit with a multi-part label", () => {
    const { rows } = toSyncRows([
      tx({
        transaction_amount: { amount: "12.50", currency: "EUR" },
        credit_debit_indicator: "DBIT",
        booking_date: "2026-10-05",
        value_date: "2026-10-04",
        remittance_information: ["CB  CAFE  TEST ", "FACT 0410"],
      }),
    ]);
    expect(rows).toEqual([
      { date: day("2026-10-05"), amount: -12.5, rawLabel: "CB CAFE TEST FACT 0410" },
    ]);
  });

  it("falls back on the value date for a credit", () => {
    const { rows } = toSyncRows([
      tx({
        transaction_amount: { amount: "1500.00", currency: "EUR" },
        credit_debit_indicator: "CRDT",
        value_date: "2026-10-01",
        remittance_information: ["VIR SALAIRE TEST"],
      }),
    ]);
    expect(rows).toEqual([{ date: day("2026-10-01"), amount: 1500, rawLabel: "VIR SALAIRE TEST" }]);
  });

  it("counts pending rows without importing them", () => {
    const r = toSyncRows([
      tx({
        transaction_amount: { amount: "35.40", currency: "EUR" },
        credit_debit_indicator: "DBIT",
        status: "PDNG",
        booking_date: "2026-11-02",
      }),
      tx({
        transaction_amount: { amount: "10.00", currency: "EUR" },
        credit_debit_indicator: "CRDT",
        status: "PDNG",
        booking_date: "2026-11-02",
      }),
    ]);
    expect(r).toEqual({ rows: [], pendingCount: 2, pendingTotal: -25.4 });
  });

  it("drops a row without a date and labels an empty remittance with a dash", () => {
    const { rows } = toSyncRows([
      tx({ credit_debit_indicator: "DBIT", remittance_information: ["NO DATE TEST"] }),
      tx({
        transaction_amount: { amount: "3.00", currency: "EUR" },
        credit_debit_indicator: "DBIT",
        booking_date: "2026-10-07",
        remittance_information: [],
      }),
      tx({
        transaction_amount: { amount: "4.00", currency: "EUR" },
        credit_debit_indicator: "DBIT",
        booking_date: "2026-10-08",
      }),
    ]);
    expect(rows).toEqual([
      { date: day("2026-10-07"), amount: -3, rawLabel: "—" },
      { date: day("2026-10-08"), amount: -4, rawLabel: "—" },
    ]);
  });
});

describe("syncWindowStart", () => {
  const now = new Date("2026-11-03T10:00:00.000Z");

  it.each([
    [{ syncFrom: day("2026-10-28"), lastSyncedDate: null }, "2026-10-28"],
    [{ syncFrom: day("2026-09-01"), lastSyncedDate: day("2026-11-03") }, "2026-10-27"],
    [{ syncFrom: day("2026-10-30"), lastSyncedDate: day("2026-11-03") }, "2026-10-30"],
    [{ syncFrom: null, lastSyncedDate: null }, "2023-11-03"],
    [{ syncFrom: day("2020-01-01"), lastSyncedDate: null }, "2023-11-03"],
  ])("%o → %s", (a, expected) => {
    expect(syncWindowStart(a, now)).toBe(expected);
  });
});

describe("pickBalances", () => {
  const now = new Date("2026-11-03T10:00:00.000Z");
  const bal = (balance_type: string, amount: string, reference_date?: string): EbBalance => ({
    balance_type,
    balance_amount: { amount, currency: "EUR" },
    ...(reference_date ? { reference_date } : {}),
  });

  it("reads the closing booked and the expected balances", () => {
    expect(
      pickBalances([bal("CLBD", "1234.56", "2026-10-31"), bal("XPCD", "1200.00")], now),
    ).toEqual({
      booked: { amount: 1234.56, date: day("2026-10-31") },
      expected: { amount: 1200, date: day("2026-11-03") },
    });
  });

  it("keeps the latest of several closing balances", () => {
    expect(
      pickBalances([bal("CLBD", "10.00", "2026-09-30"), bal("CLBD", "-5.25", "2026-10-31")], now)
        .booked,
    ).toEqual({ amount: -5.25, date: day("2026-10-31") });
  });

  it("returns null for missing balance types", () => {
    expect(pickBalances([bal("ITAV", "5.00")], now)).toEqual({ booked: null, expected: null });
  });
});

import { describe, it, expect } from "vitest";
import { parseAmount, readAmount } from "@/lib/amount";
import { transactionInputSchema } from "@/lib/validation/transaction";
import { budgetLineSchema } from "@/lib/validation/budget";
import { accountInputSchema } from "@/lib/validation/account";

describe("parseAmount", () => {
  it("reads either decimal mark and thousands groups", () => {
    expect(parseAmount("-12,34")).toBe(-12.34);
    expect(parseAmount("12.5")).toBe(12.5);
    expect(parseAmount("1 234,56")).toBe(1234.56);
    expect(parseAmount("1.234,56")).toBe(1234.56);
    expect(parseAmount("-1,234.56")).toBe(-1234.56);
    expect(parseAmount("1.234.567,8")).toBe(1234567.8);
    expect(parseAmount("+20")).toBe(20);
  });

  it("rejects malformed groupings and text", () => {
    expect(parseAmount("12.34,5,6")).toBeNaN();
    expect(parseAmount("1.23,45")).toBeNaN();
    expect(parseAmount("12,34,56")).toBeNaN();
    expect(parseAmount("abc")).toBeNaN();
    expect(parseAmount("")).toBeNaN();
  });
});

describe("readAmount", () => {
  const error = (v: string | number) => {
    const r = readAmount(v);
    return r.ok ? null : r.error;
  };

  it("accepts cents, trailing zeros and large values", () => {
    expect(readAmount("12,30")).toEqual({ ok: true, value: 12.3 });
    expect(readAmount("0,500")).toEqual({ ok: true, value: 0.5 });
    expect(readAmount("1234567890,12")).toEqual({ ok: true, value: 1234567890.12 });
    expect(readAmount(1234567890.12)).toEqual({ ok: true, value: 1234567890.12 });
  });

  it("rejects fractions of a cent", () => {
    expect(error("12,3456")).toBe("AMOUNT_PRECISION");
    expect(error("0.001")).toBe("AMOUNT_PRECISION");
    expect(error(12.345)).toBe("AMOUNT_PRECISION");
  });

  it("rejects a lone thousands separator as ambiguous", () => {
    expect(error("1.234")).toBe("AMOUNT_AMBIGUOUS");
    expect(error("12,345")).toBe("AMOUNT_AMBIGUOUS");
    expect(error("-1,234")).toBe("AMOUNT_AMBIGUOUS");
    expect(error("1 234")).toBeNull();
  });

  it("rejects text and out-of-range values", () => {
    expect(error("douze")).toBe("AMOUNT_INVALID");
    expect(error("1e12")).toBe("AMOUNT_INVALID");
    expect(error(Infinity)).toBe("AMOUNT_INVALID");
  });
});

const firstMessage = (r: { success: boolean; error?: { issues: { message: string }[] } }) =>
  r.success ? null : r.error!.issues[0].message;

describe("transactionInputSchema amount and label", () => {
  const base = { accountId: "a", date: "2026-02-01", type: "CARD", label: "Café" } as const;
  const check = (input: Record<string, unknown>) =>
    firstMessage(transactionInputSchema.safeParse({ ...base, ...input }));

  it("accepts a grouped amount", () => {
    const r = transactionInputSchema.safeParse({ ...base, amount: "1.234,56" });
    expect(r.success && r.data.amount).toBe(1234.56);
  });

  it("returns a specific code per amount problem", () => {
    expect(check({ amount: "12,3456" })).toBe("AMOUNT_PRECISION");
    expect(check({ amount: "1.234" })).toBe("AMOUNT_AMBIGUOUS");
    expect(check({ amount: "0" })).toBe("AMOUNT_ZERO");
    expect(check({ amount: "0,00" })).toBe("AMOUNT_ZERO");
    expect(check({ amount: "douze" })).toBe("AMOUNT_INVALID");
  });

  it("rejects a label over 200 characters", () => {
    expect(check({ amount: "-1", label: "x".repeat(201) })).toBe("LABEL_TOO_LONG");
    expect(check({ amount: "-1", label: "x".repeat(200) })).toBeNull();
  });
});

describe("budget and account amounts", () => {
  it("no longer rounds a budget line silently", () => {
    expect(firstMessage(budgetLineSchema.safeParse({ plannedAmount: "12,3456" }))).toBe(
      "AMOUNT_PRECISION",
    );
    expect(firstMessage(budgetLineSchema.safeParse({ plannedAmount: "1.234" }))).toBe(
      "AMOUNT_AMBIGUOUS",
    );
    const ok = budgetLineSchema.safeParse({ plannedAmount: "300,5" });
    expect(ok.success && ok.data.plannedAmount).toBe(300.5);
  });

  it("checks the account opening balance the same way, empty meaning 0", () => {
    const base = { name: "Courant", type: "CHECKING" } as const;
    const parse = (initialBalance?: string) =>
      accountInputSchema.safeParse({ ...base, initialBalance });
    expect(firstMessage(parse("12,3456"))).toBe("AMOUNT_PRECISION");
    expect(firstMessage(parse("1,234"))).toBe("AMOUNT_AMBIGUOUS");
    const empty = parse("");
    expect(empty.success && empty.data.initialBalance).toBe(0);
    const undef = parse(undefined);
    expect(undef.success && undef.data.initialBalance).toBe(0);
  });
});

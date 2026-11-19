import { describe, it, expect, vi, afterEach } from "vitest";
import { Prisma } from "@prisma/client";
import { ZodError, z } from "zod";
import { serialize } from "@/server/mcp/serialize";
import { McpToolError, toolErrorCode, toolErrorDetail } from "@/server/mcp/errors";
import { BudgetAccessError } from "@/server/services/budgets";
import { TransactionAccessError } from "@/server/services/transactions";
import { RuleValidationError } from "@/server/services/categorization";

afterEach(() => vi.restoreAllMocks());

describe("serialize", () => {
  it("writes date-only fields as ISO days and other dates as ISO instants", () => {
    const at = new Date("2026-10-05T12:34:56.000Z");
    expect(
      serialize({ date: at, periodDate: at, periodEnd: at, createdAt: at, nested: [{ to: at }] }),
    ).toEqual({
      date: "2026-10-05",
      periodDate: "2026-10-05",
      periodEnd: "2026-10-05",
      createdAt: "2026-10-05T12:34:56.000Z",
      nested: [{ to: "2026-10-05" }],
    });
  });

  it("turns Decimals and bigints into numbers", () => {
    expect(serialize({ amount: new Prisma.Decimal("-12.30"), count: BigInt(3) })).toEqual({
      amount: -12.3,
      count: 3,
    });
  });

  it("drops raw labels, e-mails and encrypted or hashed columns, keeps the masked IBAN", () => {
    expect(
      serialize({
        label: "Bakery",
        rawLabel: "CB BAKERY 1234",
        email: "a@b.c",
        ibanEnc: "v1.x",
        ibanHash: "h",
        labelEnc: "v1.y",
        ibanMasked: "•••• 0189",
        items: [{ rawLabel: "X", label: "Y" }],
      }),
    ).toEqual({ label: "Bakery", ibanMasked: "•••• 0189", items: [{ label: "Y" }] });
  });

  it("adds the category path next to a known category id", () => {
    const categoryPaths = new Map([["c1", "Home / Rent"]]);
    expect(
      serialize(
        { rows: [{ categoryId: "c1" }, { categoryId: "zz" }, { categoryId: null }] },
        {
          categoryPaths,
        },
      ),
    ).toEqual({
      rows: [
        { categoryId: "c1", categoryPath: "Home / Rent" },
        { categoryId: "zz" },
        { categoryId: null },
      ],
    });
  });
});

describe("toolErrorCode", () => {
  it("keeps the codes of the service access errors", () => {
    expect(toolErrorCode(new BudgetAccessError("NOT_FOUND"))).toBe("NOT_FOUND");
    expect(toolErrorCode(new BudgetAccessError("FORBIDDEN"))).toBe("FORBIDDEN");
    expect(toolErrorCode(new BudgetAccessError("INVALID_PERIOD"))).toBe("INVALID_PERIOD");
    expect(toolErrorCode(new BudgetAccessError("INVALID_PARENT"))).toBe("INVALID_INPUT");
    expect(toolErrorCode(new TransactionAccessError("LOCKED_FIELDS"))).toBe("FORBIDDEN");
    expect(toolErrorCode(new McpToolError("INVALID_PERIOD"))).toBe("INVALID_PERIOD");
  });

  it("maps validation errors to INVALID_INPUT", () => {
    const zodError = z.number().safeParse("x").error;
    expect(zodError).toBeInstanceOf(ZodError);
    expect(toolErrorCode(zodError)).toBe("INVALID_INPUT");
    expect(toolErrorCode(new RuleValidationError("bad regex"))).toBe("INVALID_INPUT");
  });

  it("details the service code when it is not the tool code itself", () => {
    expect(toolErrorDetail(new TransactionAccessError("LOCKED_FIELDS"))).toBe("LOCKED_FIELDS");
    expect(toolErrorDetail(new BudgetAccessError("INVALID_LINE"))).toBe("INVALID_LINE");
    expect(toolErrorDetail(new BudgetAccessError("FORBIDDEN"))).toBeUndefined();
    expect(toolErrorDetail(new BudgetAccessError("NOT_FOUND"))).toBeUndefined();
    expect(toolErrorDetail(new Error("connect ECONNREFUSED 10.0.0.1:3306"))).toBeUndefined();
  });

  it("logs an unknown error server-side and returns FAILED", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const error = new Error("connect ECONNREFUSED 10.0.0.1:3306");
    expect(toolErrorCode(error)).toBe("FAILED");
    expect(log).toHaveBeenCalledWith(expect.any(String), error);
  });
});

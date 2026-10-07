import { describe, it, expect, vi } from "vitest";
import { ImportAccessError } from "@/server/services/imports/errors";
import { importErrorResponse } from "@/server/transport/http/import-errors";

describe("importErrorResponse", () => {
  it("maps known codes to their status", async () => {
    for (const [code, status] of [
      ["INVALID_MAPPING", 400],
      ["NOT_COMMITTABLE", 409],
      ["NOTHING_TO_IMPORT", 409],
      ["EMPTY", 422],
    ] as const) {
      const res = importErrorResponse(new ImportAccessError(code), "COMMIT_FAILED");
      expect(res.status).toBe(status);
      expect(await res.json()).toEqual({ error: code });
    }
  });

  it("reads every other access error as FORBIDDEN, so batch ids can't be probed", async () => {
    const res = importErrorResponse(new ImportAccessError("NOT_FOUND"), "COMMIT_FAILED");
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "FORBIDDEN" });
  });

  it("falls back to the given code for unexpected errors", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = importErrorResponse(new Error("boom"), "COMMIT_FAILED");
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: "COMMIT_FAILED" });
    spy.mockRestore();
  });
});

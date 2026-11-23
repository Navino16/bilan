import { describe, it, expect } from "vitest";
import { parseEnv } from "@/env";

const valid = {
  NODE_ENV: "test",
  APP_URL: "http://localhost:3000",
  DATABASE_URL: "mysql://app:app_password@localhost:3306/budget",
  AUTH_SECRET: "x".repeat(32),
  DATA_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString("base64"),
  SEARCH_TOKEN_KEY: Buffer.alloc(32, 2).toString("base64"),
};

describe("parseEnv", () => {
  it("accepts a valid environment", () => {
    expect(() => parseEnv(valid)).not.toThrow();
  });
  it("rejects a missing DATABASE_URL", () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { DATABASE_URL, ...rest } = valid;
    expect(() => parseEnv(rest as never)).toThrow();
  });
  it("rejects a DATA_ENCRYPTION_KEY that is not 32 bytes", () => {
    expect(() => parseEnv({ ...valid, DATA_ENCRYPTION_KEY: "dG9vc2hvcnQ=" })).toThrow();
  });
  it("defaults TRUSTED_IP_HEADER to x-forwarded-for and lowercases it", () => {
    expect(parseEnv(valid).TRUSTED_IP_HEADER).toBe("x-forwarded-for");
    expect(parseEnv({ ...valid, TRUSTED_IP_HEADER: "X-Real-IP" }).TRUSTED_IP_HEADER).toBe(
      "x-real-ip",
    );
  });
  it.each(["", " ", "x real ip", "x-real-ip,x-forwarded-for"])(
    "rejects the TRUSTED_IP_HEADER %j at boot",
    (value) => {
      expect(() => parseEnv({ ...valid, TRUSTED_IP_HEADER: value })).toThrow();
    },
  );
});
